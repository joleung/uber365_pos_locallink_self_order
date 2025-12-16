# -*- coding: utf-8 -*-

from odoo import models, api


class PosPayment(models.Model):
    _inherit = 'pos.payment'

    @api.model
    def _load_pos_self_data_fields(self, config):
        """
        Export GoLocalLink transaction metadata fields to self-order frontend.

        These fields are defined in the uber365_pos_locallink module:
        - transaction_id (UTI - Universal Transaction Identifier)
        - pdq_card_bin (First 6 digits of card)
        - card_no (Last 4 digits - standard field)
        - payment_method_authcode (Authorization code - standard field)
        - ticket (Receipt data - standard field)
        """
        fields = super()._load_pos_self_data_fields(config)

        # Add GoLocalLink-specific fields if not already included
        golocallink_fields = ['transaction_id', 'pdq_card_bin', 'card_no', 'payment_method_authcode', 'ticket']

        for field in golocallink_fields:
            if field not in fields:
                fields.append(field)

        return fields
