# -*- coding: utf-8 -*-

import logging
import requests
import urllib3
from odoo import http, fields, _
from odoo.http import request, Response
from odoo.exceptions import UserError
from odoo.addons.pos_self_order.controllers.orders import PosSelfOrderController
from werkzeug.exceptions import Unauthorized, BadRequest

# Disable SSL warnings for GoLocalLink (often uses self-signed certificates)
urllib3.disable_warnings(urllib3.exceptions.InsecureRequestWarning)

_logger = logging.getLogger(__name__)


class PosSelfOrderGoLocalLinkController(PosSelfOrderController):
    """Controller for GoLocalLink payment terminal integration with self-ordering kiosks"""

    @http.route('/kiosk/golocallink/payment/<int:config_id>', type='jsonrpc', auth='public', cors='*')
    def kiosk_golocallink_payment(self, config_id, order_data, access_token, **kwargs):
        """
        Initiates GoLocalLink payment for kiosk order

        Steps:
        1. Verify authorization and load POS config
        2. Validate kiosk GoLocalLink is enabled
        3. Create or update order via process_order()
        4. Call payment_method._payment_request_from_kiosk()
        5. Return UTI for frontend SSE connection

        Returns:
        {
            'uti': '550e8400-...',
            'amount': 10.50,
            'order_id': 123,
            'access_token': 'abc...'
        }
        """
        try:
            # Verify authorization
            pos_config, table = self._verify_authorization(access_token, "", {})

            if pos_config.id != config_id:
                raise Unauthorized("Invalid POS configuration")

            # Validate kiosk GoLocalLink is enabled
            if not pos_config.kiosk_golocallink_enabled:
                raise BadRequest("Kiosk GoLocalLink is not enabled for this POS")

            # Process order (create or update)
            # Signature: process_order(order, access_token, table_identifier, device_type)
            # Returns: dict with serialized data, not ORM record
            order_response = self.process_order(order_data, access_token, '', 'kiosk')

            if not order_response or not order_response.get('pos.order'):
                raise BadRequest("Failed to create order")

            # Extract order ID from response and browse to get ORM record
            order_id = order_response['pos.order'][0]['id']
            order = request.env['pos.order'].sudo().browse(order_id)

            if not order or not order.exists():
                raise BadRequest("Order not found after creation")

            # Get default payment method for GoLocalLink
            # In kiosk mode, we assume the first available payment method or a specific one
            payment_method = pos_config.payment_method_ids.filtered(
                lambda p: not p.is_cash_count and not p.type == 'pay_later'
            )[:1]

            if not payment_method:
                raise BadRequest("No valid payment method configured for kiosk")

            # Call _payment_request_from_kiosk to initiate GoLocalLink payment
            payment_result = payment_method._payment_request_from_kiosk(order)

            if not payment_result or not payment_result.get('uti'):
                raise UserError(_("Failed to initiate GoLocalLink payment"))

            # Return payment initiation data
            return {
                'uti': payment_result['uti'],
                'amount': payment_result.get('amount', order.amount_total),
                'amount_smallest_unit': payment_result.get('amount_smallest_unit'),
                'currency': payment_result.get('currency', order.currency_id.name),
                'order_id': order.id,
                'access_token': order.access_token,
                'pos_reference': order.pos_reference,
            }

        except Unauthorized as e:
            _logger.warning("Unauthorized kiosk GoLocalLink payment attempt: %s", str(e))
            raise
        except BadRequest as e:
            _logger.warning("Bad request for kiosk GoLocalLink payment: %s", str(e))
            raise
        except Exception as e:
            _logger.error("Error initiating kiosk GoLocalLink payment: %s", str(e), exc_info=True)
            raise UserError(_("Payment initiation failed: %s") % str(e))

    @http.route('/kiosk/golocallink/events/<string:uti>', type='http', auth='public', cors='*')
    def kiosk_golocallink_events(self, uti, config_id=None, **kwargs):
        """
        Proxies SSE events from GoLocalLink server to kiosk frontend

        This endpoint acts as a proxy between the kiosk frontend and the GoLocalLink
        server to stream payment status updates via Server-Sent Events.

        Headers:
        - Content-Type: text/event-stream
        - Cache-Control: no-cache
        - X-Accel-Buffering: no

        Streams events from {kiosk_golocallink_url}/api/events/{uti}
        """
        try:
            if not config_id:
                return Response("Missing config_id parameter", status=400)

            pos_config = request.env['pos.config'].sudo().browse(int(config_id))

            if not pos_config.exists():
                return Response("Invalid POS configuration", status=404)

            if not pos_config.kiosk_golocallink_enabled:
                return Response("Kiosk GoLocalLink not enabled", status=403)

            # Build GoLocalLink SSE URL
            golocallink_url = pos_config.kiosk_golocallink_url.rstrip('/')
            sse_url = f"{golocallink_url}/api/events/{uti}"

            if pos_config.kiosk_pdq_debug_mode:
                _logger.info("Proxying SSE events from: %s", sse_url)

            # Stream events from GoLocalLink server (SSL verification disabled)
            def event_stream():
                try:
                    with requests.get(sse_url, stream=True, timeout=180, verify=False) as response:
                        for line in response.iter_lines(decode_unicode=True):
                            if line:
                                yield f"{line}\n\n"
                except Exception as e:
                    _logger.error("Error streaming GoLocalLink events: %s", str(e))
                    yield f"event: error\ndata: {str(e)}\n\n"

            return Response(
                event_stream(),
                mimetype='text/event-stream',
                headers={
                    'Cache-Control': 'no-cache',
                    'X-Accel-Buffering': 'no',
                }
            )

        except Exception as e:
            _logger.error("Error in GoLocalLink SSE proxy: %s", str(e), exc_info=True)
            return Response(f"Error: {str(e)}", status=500)

    @http.route('/kiosk/golocallink/cancel', type='jsonrpc', auth='public', cors='*')
    def kiosk_golocallink_cancel(self, config_id, **kwargs):
        """
        Cancels in-progress payment

        Sends POST to {kiosk_golocallink_url}/api/txn/cancel
        """
        try:
            pos_config = request.env['pos.config'].sudo().browse(config_id)

            if not pos_config.exists():
                raise BadRequest("Invalid POS configuration")

            if not pos_config.kiosk_golocallink_enabled:
                raise BadRequest("Kiosk GoLocalLink not enabled")

            golocallink_url = pos_config.kiosk_golocallink_url.rstrip('/')
            cancel_url = f"{golocallink_url}/api/txn/cancel"

            if pos_config.kiosk_pdq_debug_mode:
                _logger.info("Cancelling kiosk GoLocalLink payment: %s", cancel_url)

            response = requests.post(cancel_url, timeout=10, verify=False)

            if response.status_code == 200:
                return {'status': 'cancelled'}
            else:
                _logger.warning("Failed to cancel payment: HTTP %s", response.status_code)
                return {'status': 'error', 'message': 'Cancel request failed'}

        except Exception as e:
            _logger.error("Error cancelling kiosk GoLocalLink payment: %s", str(e), exc_info=True)
            return {'status': 'error', 'message': str(e)}

    @http.route('/kiosk/golocallink/status/<string:uti>', type='jsonrpc', auth='public', cors='*')
    def kiosk_golocallink_status(self, uti, config_id, **kwargs):
        """
        Retrieves transaction status from GoLocalLink

        Used when SSE connection lost but payment may have been processed
        Fetches from GET {kiosk_golocallink_url}/api/txn/{uti}

        Returns transaction status: approved, declined, or in-progress
        """
        try:
            pos_config = request.env['pos.config'].sudo().browse(config_id)

            if not pos_config.exists():
                raise BadRequest("Invalid POS configuration")

            if not pos_config.kiosk_golocallink_enabled:
                raise BadRequest("Kiosk GoLocalLink not enabled")

            golocallink_url = pos_config.kiosk_golocallink_url.rstrip('/')
            status_url = f"{golocallink_url}/api/txn/{uti}"

            if pos_config.kiosk_pdq_debug_mode:
                _logger.info("Checking kiosk GoLocalLink payment status: %s", status_url)

            response = requests.get(status_url, timeout=10, verify=False)

            if response.status_code == 200:
                data = response.json()

                # Determine status based on GoLocalLink response
                if data.get('transApproved'):
                    return {
                        'status': 'approved',
                        'data': data
                    }
                elif data.get('transCancelled'):
                    return {
                        'status': 'cancelled',
                        'data': data
                    }
                else:
                    return {
                        'status': 'in_progress',
                        'data': data
                    }
            else:
                return {'status': 'error', 'message': f"HTTP {response.status_code}"}

        except Exception as e:
            _logger.error("Error checking kiosk GoLocalLink status: %s", str(e), exc_info=True)
            return {'status': 'error', 'message': str(e)}

    @http.route('/kiosk/golocallink/complete', type='jsonrpc', auth='public', cors='*')
    def kiosk_golocallink_complete(self, order_id, access_token, transaction_data, **kwargs):
        """
        Completes payment after terminal approval

        Steps:
        1. Validate order and access token
        2. Create pos.payment record with transaction metadata
        3. Call order.add_payment() and order.action_pos_order_paid()
        4. Send WebSocket notification: PAYMENT_STATUS
        5. Return order confirmation data
        """
        try:
            # Find and validate order
            order = request.env['pos.order'].sudo().search([
                ('id', '=', order_id),
                ('access_token', '=', access_token)
            ], limit=1)

            if not order:
                raise Unauthorized("Invalid order or access token")

            # Validate transaction data
            required_fields = ['uti', 'bank_id_no', 'card_no_4digit', 'auth_code']
            for field in required_fields:
                if field not in transaction_data:
                    raise BadRequest(f"Missing required field: {field}")

            pos_config = order.config_id

            # Get payment method
            payment_method = pos_config.payment_method_ids.filtered(
                lambda p: not p.is_cash_count and not p.type == 'pay_later'
            )[:1]

            if not payment_method:
                raise BadRequest("No valid payment method configured")

            # Add payment to order
            order.add_payment({
                'amount': order.amount_total,
                'payment_date': fields.Datetime.now(),
                'payment_method_id': payment_method.id,
                'transaction_id': transaction_data['uti'],
                'pdq_card_bin': transaction_data['bank_id_no'],
                'card_no': transaction_data['card_no_4digit'],
                'payment_method_authcode': transaction_data['auth_code'],
                'ticket': transaction_data.get('cardholder_receipt', ''),
                'pos_order_id': order.id,
            })

            # Mark order as paid
            order.action_pos_order_paid()

            # Send payment success notification
            if pos_config.self_ordering_mode == 'kiosk':
                order._send_payment_result('Success')

            if pos_config.kiosk_pdq_debug_mode:
                _logger.info(
                    "Kiosk GoLocalLink payment completed - Order: %s, UTI: %s",
                    order.pos_reference,
                    transaction_data['uti']
                )

            return {
                'status': 'success',
                'order_id': order.id,
                'pos_reference': order.pos_reference,
                'amount_total': order.amount_total,
            }

        except Unauthorized as e:
            _logger.warning("Unauthorized payment completion attempt: %s", str(e))
            raise
        except BadRequest as e:
            _logger.warning("Bad request for payment completion: %s", str(e))
            raise
        except Exception as e:
            _logger.error("Error completing kiosk GoLocalLink payment: %s", str(e), exc_info=True)
            raise UserError(_("Payment completion failed: %s") % str(e))
