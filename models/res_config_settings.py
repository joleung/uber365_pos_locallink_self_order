# -*- coding: utf-8 -*-

from odoo import fields, models


class ResConfigSettings(models.TransientModel):
    _inherit = 'res.config.settings'

    # Kiosk GoLocalLink settings - related to pos.config fields
    pos_kiosk_golocallink_enabled = fields.Boolean(
        related='pos_config_id.kiosk_golocallink_enabled',
        readonly=False,
        string='Enable GoLocalLink for Kiosk'
    )
    pos_kiosk_golocallink_url = fields.Char(
        related='pos_config_id.kiosk_golocallink_url',
        readonly=False,
        string='Kiosk GoLocalLink Server URL'
    )
    pos_kiosk_golocallink_termid = fields.Char(
        related='pos_config_id.kiosk_golocallink_termid',
        readonly=False,
        string='Kiosk Terminal ID'
    )
    pos_kiosk_pdq_debug_mode = fields.Boolean(
        related='pos_config_id.kiosk_pdq_debug_mode',
        readonly=False,
        string='Kiosk PDQ Debug Mode'
    )
