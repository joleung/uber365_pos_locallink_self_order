/** @odoo-module */

import { Component } from "@odoo/owl";
import { useService } from "@web/core/utils/hooks";

/**
 * GoLocalLink Payment Status Component
 *
 * Displays real-time payment status for kiosk customers
 * Shows spinner, icons, messages, and action buttons based on payment status
 */
export class GoLocalLinkPaymentStatus extends Component {
    static template = "uber365_pos_locallink_self_order.GoLocalLinkPaymentStatus";

    static props = {
        status: Object,      // Payment status state from service
        onCancel: Function,  // Cancel button handler
        onForceDone: Function,  // Force check status button handler
    };

    setup() {
        this.selfOrder = useService("self_order");
    }

    /**
     * Get status message based on current status
     */
    get statusMessage() {
        switch (this.props.status.status) {
            case 'waiting':
                return 'Initiating payment...';
            case 'waitingCard':
                return 'Please tap your card on the terminal';
            case 'processing':
                return 'Processing payment...';
            case 'done':
                return 'Payment Successful!';
            case 'error':
                return 'Payment Failed';
            default:
                return '';
        }
    }

    /**
     * Get sub-message based on current status
     */
    get subMessage() {
        switch (this.props.status.status) {
            case 'waitingCard':
                return `Amount: ${this.formatCurrency(this.props.status.amount)}`;
            case 'processing':
                return 'Please do not remove your card';
            case 'done':
                return 'Thank you for your payment';
            default:
                return '';
        }
    }

    /**
     * Format currency amount
     */
    formatCurrency(amount) {
        const currency = this.selfOrder.config.currency_id;
        return new Intl.NumberFormat('en-US', {
            style: 'currency',
            currency: currency.name,
        }).format(amount);
    }

    /**
     * Show cancel button only when waiting for card
     */
    get showCancelButton() {
        return this.props.status.status === 'waitingCard';
    }

    /**
     * Show force check button when waiting for card or processing
     */
    get showForceCheckButton() {
        return this.props.status.status === 'waitingCard' ||
               this.props.status.status === 'processing';
    }

    /**
     * Get icon class based on status
     */
    get iconClass() {
        switch (this.props.status.status) {
            case 'waiting':
                return 'fa fa-spinner fa-spin fa-3x';
            case 'waitingCard':
                return 'fa fa-credit-card fa-3x';
            case 'processing':
                return 'fa fa-spinner fa-pulse fa-3x';
            case 'done':
                return 'fa fa-check-circle fa-3x text-success';
            case 'error':
                return 'fa fa-times-circle fa-3x text-danger';
            default:
                return '';
        }
    }
}
