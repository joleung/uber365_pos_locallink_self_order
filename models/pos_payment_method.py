# -*- coding: utf-8 -*-

import logging
import requests
import urllib3
from odoo import models, api, _
from odoo.exceptions import UserError

# Disable SSL warnings for GoLocalLink (often uses self-signed certificates)
urllib3.disable_warnings(urllib3.exceptions.InsecureRequestWarning)

_logger = logging.getLogger(__name__)


class PosPaymentMethod(models.Model):
    _inherit = "pos.payment.method"

    @api.model
    def _load_pos_self_data_search_read(self, data, config):
        """
        Override to use sudo() for public access from kiosk.

        The kiosk uses auth='public', so it doesn't have permission to read
        pos.payment.method by default. We use sudo() to allow the kiosk to
        read payment methods.
        """
        # Use sudo() to bypass access restrictions for public kiosk access
        domain = self.sudo()._load_pos_self_data_domain(data, config)
        if domain is False:
            return []

        records = self.sudo().search(domain)
        return self.sudo()._load_pos_self_data_read(records, config)

    @api.model
    def _load_pos_self_data_domain(self, data, config):
        """
        Override to include payment methods when GoLocalLink is enabled for kiosk.

        The base pos_self_order module only loads payment methods with
        use_payment_terminal in ['adyen', 'stripe']. We extend this to also
        load payment methods when GoLocalLink is enabled.
        """
        if config.self_ordering_mode == 'kiosk':
            # If GoLocalLink is enabled, load all payment methods
            if config.kiosk_golocallink_enabled:
                return [('id', 'in', data['pos.config'][0]['payment_method_ids'])]

            # Otherwise, use the default adyen/stripe filter
            return [
                ('use_payment_terminal', 'in', ['adyen', 'stripe']),
                ('id', 'in', data['pos.config'][0]['payment_method_ids'])
            ]
        else:
            # Mobile mode: no payment methods
            return [('id', '=', False)]

    def _payment_request_from_kiosk(self, order):
        """
        Initiates GoLocalLink payment for kiosk orders.

        This method is called by the kiosk payment controller to initiate
        a payment request. For GoLocalLink, it sends a POST request to
        the GoLocalLink server to create a new payment transaction and
        returns the UTI (Universal Transaction Identifier) for SSE streaming.
        """
        config = order.session_id.config_id

        # Check if this is a GoLocalLink kiosk payment
        if not config.kiosk_golocallink_enabled:
            return super()._payment_request_from_kiosk(order)

        # Validate GoLocalLink configuration
        if not config.kiosk_golocallink_url or not config.kiosk_golocallink_termid:
            raise UserError(_(
                'Kiosk GoLocalLink is not properly configured. '
                'Please configure the Server URL and Terminal ID in POS settings.'
            ))

        try:
            # Convert amount to smallest currency unit (e.g., £10.50 → 1050 pence)
            currency = order.currency_id
            decimal_places = currency.decimal_places or 2
            multiplier = 10 ** decimal_places
            amount_smallest_unit = int(round(order.amount_total * multiplier))

            # Prepare request payload
            payload = {
                'termid': config.kiosk_golocallink_termid,
                'amttxn': amount_smallest_unit,
                'ref': order.pos_reference or f"K-{order.id}",
            }

            # Send POST request to GoLocalLink server
            url = f"{config.kiosk_golocallink_url.rstrip('/')}/api/sse/txn/sale"

            if config.kiosk_pdq_debug_mode:
                _logger.info(
                    'Kiosk GoLocalLink payment request - Order: %s, Amount: %s (%.2f %s), URL: %s',
                    order.pos_reference,
                    amount_smallest_unit,
                    order.amount_total,
                    currency.name,
                    url
                )

            # Send POST request with SSL verification disabled (for self-signed certs)
            response = requests.post(
                url,
                json=payload,
                timeout=30,
                headers={'Content-Type': 'application/json'},
                verify=False  # Disable SSL certificate verification
            )

            # Check response status
            if response.status_code == 201:
                result = response.json()
                uti = result.get('uti')

                if not uti:
                    raise UserError(_(
                        'GoLocalLink payment initiation failed: No UTI received from server.'
                    ))

                if config.kiosk_pdq_debug_mode:
                    _logger.info(
                        'Kiosk GoLocalLink payment initiated - UTI: %s, Order: %s',
                        uti,
                        order.pos_reference
                    )

                # Return UTI and payment details for frontend
                return {
                    'uti': uti,
                    'amount': order.amount_total,
                    'amount_smallest_unit': amount_smallest_unit,
                    'currency': currency.name,
                }
            else:
                error_msg = f"HTTP {response.status_code}"
                try:
                    error_data = response.json()
                    error_msg = error_data.get('error', error_msg)
                except:
                    error_msg = response.text or error_msg

                raise UserError(_(
                    'GoLocalLink payment initiation failed: %s'
                ) % error_msg)

        except requests.exceptions.Timeout:
            raise UserError(_(
                'GoLocalLink payment server connection timeout. '
                'Please check if the GoLocalLink server is running and accessible.'
            ))
        except requests.exceptions.ConnectionError:
            raise UserError(_(
                'Cannot connect to GoLocalLink payment server at %s. '
                'Please check the server URL and network connection.'
            ) % config.kiosk_golocallink_url)
        except requests.exceptions.RequestException as e:
            raise UserError(_(
                'GoLocalLink payment request failed: %s'
            ) % str(e))
