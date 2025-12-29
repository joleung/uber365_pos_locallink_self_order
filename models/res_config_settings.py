# -*- coding: utf-8 -*-

from odoo import fields, models


class ResConfigSettings(models.TransientModel):
    _inherit = 'res.config.settings'

    pos_golocallink_enabled = fields.Boolean(
        related='pos_config_id.golocallink_enabled',
        readonly=False,
        string='Enable GoLocalLink PDQ'
    )
    pos_golocallink_url = fields.Char(
        related='pos_config_id.golocallink_url',
        readonly=False,
        string='GoLocalLink Server URL'
    )
    pos_golocallink_termid = fields.Char(
        related='pos_config_id.golocallink_termid',
        readonly=False,
        string='Terminal ID'
    )
    pos_pdq_debug_mode = fields.Boolean(
        related='pos_config_id.pdq_debug_mode',
        readonly=False,
        string='PDQ Debug Mode'
    )
