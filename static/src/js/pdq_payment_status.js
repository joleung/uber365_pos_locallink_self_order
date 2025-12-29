/** @odoo-module */

import { Component } from "@odoo/owl";

export class PDQPaymentStatus extends Component {
    static template = "uber365_pos_locallink.PDQPaymentStatus";
    static props = {
        status: Object,       // pdqPaymentStatus reactive state
        onCancel: Function,   // Cancel button handler
        onForceDone: Function // Force Done button handler
    };
}
