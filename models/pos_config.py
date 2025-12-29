# -*- coding: utf-8 -*-

import logging
from odoo import fields, models, api, http, _
from odoo.exceptions import ValidationError
from odoo.http import request

_logger = logging.getLogger(__name__)


class PosConfig(models.Model):
    _inherit = 'pos.config'

    golocallink_enabled = fields.Boolean(
        string='Enable GoLocalLink PDQ',
        default=False,
        help='Enable PAX payment terminal integration via golocallink'
    )
    golocallink_url = fields.Char(
        string='GoLocalLink Server URL',
        default='http://127.0.0.1:8080',
        help='URL of the golocallink payment gateway server (e.g., http://127.0.0.1:8080)'
    )
    golocallink_termid = fields.Char(
        string='Terminal ID',
        help='PAX terminal identifier for golocallink transactions'
    )
    pdq_debug_mode = fields.Boolean(
        string='PDQ Debug Mode',
        default=False,
        help='Enable debug logging for PDQ transactions. WARNING: Debug logs may contain sensitive payment data. Only enable for troubleshooting.'
    )

    @api.constrains('golocallink_enabled', 'golocallink_url', 'golocallink_termid')
    def _check_golocallink_config(self):
        """Validate GoLocalLink configuration when enabled"""
        for config in self:
            if config.golocallink_enabled:
                # Validate URL is provided
                if not config.golocallink_url:
                    raise ValidationError(_(
                        'GoLocalLink Server URL is required when GoLocalLink PDQ is enabled. '
                        'Please configure the Server URL in the GoLocalLink settings.'
                    ))

                # Validate URL protocol
                url = config.golocallink_url.strip()
                if not url.startswith(('http://', 'https://')):
                    raise ValidationError(_(
                        'GoLocalLink Server URL must start with http:// or https://. '
                        'Invalid URL: %s'
                    ) % config.golocallink_url)

                # Warn if using HTTP on non-localhost
                if url.startswith('http://'):
                    # Extract hostname from URL
                    hostname = url.replace('http://', '').split(':')[0].split('/')[0]
                    if hostname not in ('127.0.0.1', 'localhost', '::1'):
                        _logger.warning(
                            'GoLocalLink is configured with HTTP on non-localhost (%s). '
                            'Consider using HTTPS for production environments to secure payment data.',
                            hostname
                        )

                # Validate Terminal ID is provided
                if not config.golocallink_termid:
                    raise ValidationError(_(
                        'Terminal ID is required when GoLocalLink PDQ is enabled. '
                        'Please configure the Terminal ID in the GoLocalLink settings.'
                    ))

class POSOrder(models.Model):
    _inherit = 'pos.payment'

    # GoLocalLink PDQ transaction field
    # Note: We reuse standard fields for most PDQ data:
    # - transaction_id for UTI (Universal Transaction Identifier)
    # - card_no for last 4 digits
    # - payment_method_authcode for authorization code
    # Only Card BIN needs a custom field as there's no standard equivalent
    pdq_card_bin = fields.Char(
        string='Card BIN',
        help='First 6 digits of card number (Bank Identification Number)',
        readonly=True
    )

    @api.model
    def _load_pos_data_fields(self, config):
        """Export fields to POS frontend for proper serialization"""
        return [
            'id', 'pos_order_id', 'payment_method_id', 'amount', 'payment_date',
            'currency_id', 'uuid',
            # Standard payment fields (reused for PDQ data)
            'transaction_id', 'card_no', 'payment_method_authcode', 'ticket',
            # Custom PDQ field
            'pdq_card_bin'
        ]
