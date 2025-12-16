# -*- coding: utf-8 -*-

import logging
from odoo import fields, models, api, _
from odoo.exceptions import ValidationError

_logger = logging.getLogger(__name__)


class PosConfig(models.Model):
    _inherit = 'pos.config'

    # Kiosk-specific GoLocalLink configuration fields
    kiosk_golocallink_enabled = fields.Boolean(
        string='Enable GoLocalLink for Kiosk',
        default=False,
        help='Enable PAX payment terminal integration via GoLocalLink for self-ordering kiosk'
    )
    kiosk_golocallink_url = fields.Char(
        string='Kiosk GoLocalLink Server URL',
        default='http://127.0.0.1:8080',
        help='URL of the GoLocalLink payment gateway server for kiosk (e.g., http://127.0.0.1:8080)'
    )
    kiosk_golocallink_termid = fields.Char(
        string='Kiosk Terminal ID',
        help='PAX terminal identifier for kiosk GoLocalLink transactions'
    )
    kiosk_pdq_debug_mode = fields.Boolean(
        string='Kiosk PDQ Debug Mode',
        default=False,
        help='Enable debug logging for kiosk PDQ transactions. WARNING: Debug logs may contain sensitive payment data. Only enable for troubleshooting.'
    )

    @api.constrains('kiosk_golocallink_enabled', 'kiosk_golocallink_url', 'kiosk_golocallink_termid', 'self_ordering_mode')
    def _check_kiosk_golocallink_config(self):
        """Validate kiosk GoLocalLink configuration when enabled"""
        for config in self:
            if config.kiosk_golocallink_enabled:
                # Only validate if self-ordering mode is kiosk
                if config.self_ordering_mode != 'kiosk':
                    raise ValidationError(_(
                        'Kiosk GoLocalLink can only be enabled when Self Ordering Mode is set to "Kiosk". '
                        'Please set the Self Ordering Mode to "Kiosk" first.'
                    ))

                # Validate URL is provided
                if not config.kiosk_golocallink_url:
                    raise ValidationError(_(
                        'Kiosk GoLocalLink Server URL is required when Kiosk GoLocalLink is enabled. '
                        'Please configure the Server URL in the Kiosk GoLocalLink settings.'
                    ))

                # Validate URL protocol
                url = config.kiosk_golocallink_url.strip()
                if not url.startswith(('http://', 'https://')):
                    raise ValidationError(_(
                        'Kiosk GoLocalLink Server URL must start with http:// or https://. '
                        'Invalid URL: %s'
                    ) % config.kiosk_golocallink_url)

                # Warn if using HTTP on non-localhost
                if url.startswith('http://'):
                    # Extract hostname from URL
                    hostname = url.replace('http://', '').split(':')[0].split('/')[0]
                    if hostname not in ('127.0.0.1', 'localhost', '::1'):
                        _logger.warning(
                            'Kiosk GoLocalLink is configured with HTTP on non-localhost (%s). '
                            'Consider using HTTPS for production environments to secure payment data.',
                            hostname
                        )

                # Validate Terminal ID is provided
                if not config.kiosk_golocallink_termid:
                    raise ValidationError(_(
                        'Kiosk Terminal ID is required when Kiosk GoLocalLink is enabled. '
                        'Please configure the Terminal ID in the Kiosk GoLocalLink settings.'
                    ))

    # NOTE: We don't need to override _load_pos_self_data_fields for pos.config
    # because the base implementation returns [] which means "load all fields".
    # Our fields are already part of the model and will be loaded automatically.
