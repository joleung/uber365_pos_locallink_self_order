/** @odoo-module */

import { PaymentPage } from "@pos_self_order/app/pages/payment_page/payment_page";
import { patch } from "@web/core/utils/patch";
import { useService } from "@web/core/utils/hooks";
import { GoLocalLinkPaymentStatus } from "@uber365_pos_locallink_self_order/app/components/golocallink_payment_status/golocallink_payment_status";
import { _t } from "@web/core/l10n/translation";

patch(PaymentPage.prototype, {
    setup() {
        super.setup(...arguments);
        this.notification = useService("notification");

        // Debug: Check what payment methods are available
        console.log('[GoLocalLink Kiosk] Payment page setup - Detailed check:', {
            count: this.selfOrder.models['pos.payment.method']?.length || 0,
            methods: this.selfOrder.models['pos.payment.method']?.getAll?.() || [],
            allMethods: this.selfOrder.models['pos.payment.method'],
            configPaymentMethodIds: this.selfOrder?.config?.payment_method_ids,
            hasPaymentMethodModel: !!this.selfOrder.models['pos.payment.method'],
            allModelKeys: Object.keys(this.selfOrder.models || {}),
            kioskGoLocalLinkEnabled: this.selfOrder?.config?.kiosk_golocallink_enabled,
        });

        // Only initialize golocallink_payment service if kiosk mode is enabled
        // This prevents initialization issues when self-order service is still loading
        try {
            if (this.selfOrder?.config?.self_ordering_mode === 'kiosk') {
                this.golocalLinkPayment = useService("golocallink_payment");
            }
        } catch (e) {
            console.warn("GoLocalLink payment service not available:", e);
            this.golocalLinkPayment = null;
        }
    },

    /**
     * Check if GoLocalLink payment should be used
     */
    get useGoLocalLink() {
        const hasService = !!this.golocalLinkPayment;
        const isKiosk = this.selfOrder?.config?.self_ordering_mode === 'kiosk';
        const isEnabled = this.selfOrder?.config?.kiosk_golocallink_enabled;

        console.log('[GoLocalLink Kiosk] useGoLocalLink check:', {
            hasService,
            isKiosk,
            isEnabled,
            config: this.selfOrder?.config
        });

        return hasService && isKiosk && isEnabled;
    },

    /**
     * Override startPayment to handle GoLocalLink payment flow
     */
    async startPayment() {
        console.log('[GoLocalLink Kiosk] startPayment called, useGoLocalLink:', this.useGoLocalLink);

        // If GoLocalLink is not enabled, use default payment flow
        if (!this.useGoLocalLink) {
            console.log('[GoLocalLink Kiosk] Using default payment flow');
            return super.startPayment(...arguments);
        }

        console.log('[GoLocalLink Kiosk] Starting GoLocalLink payment flow');

        // GoLocalLink payment flow
        this.selfOrder.paymentError = false;

        try {
            const order = this.selfOrder.currentOrder;
            const amount = order.totalDue;

            console.log('[GoLocalLink Kiosk] Initiating payment:', { order, amount });

            // Initiate payment
            const result = await this.golocalLinkPayment.initiatePayment(order, amount);

            // Connect to SSE stream
            await this.golocalLinkPayment.connectSSE(
                result.uti,
                this.onStatusUpdate.bind(this),
                this.onPaymentComplete.bind(this),
                this.onPaymentError.bind(this)
            );
        } catch (error) {
            console.error("GoLocalLink payment initiation failed:", error);
            this.selfOrder.handleErrorNotification(error);
            this.selfOrder.paymentError = true;
        }
    },

    /**
     * Handle payment status updates
     */
    onStatusUpdate(status) {
        // Status is already updated in the service's reactive state
        // This is just for additional logging or UI updates if needed
        if (this.selfOrder.config.kiosk_pdq_debug_mode) {
            console.log(`[GoLocalLink Kiosk] Status update: ${status}`);
        }
    },

    /**
     * Handle payment completion
     */
    async onPaymentComplete(transactionData) {
        try {
            const order = this.selfOrder.currentOrder;

            // Complete payment on backend
            await this.golocalLinkPayment.completePayment(
                order.id,
                order.access_token,
                transactionData
            );

            // Show success for 2 seconds, then navigate to confirmation page
            setTimeout(() => {
                this.router.navigate("confirmation");
            }, 2000);
        } catch (error) {
            console.error("GoLocalLink payment completion failed:", error);
            this.selfOrder.handleErrorNotification(error);
            this.selfOrder.paymentError = true;
        }
    },

    /**
     * Handle payment errors
     */
    onPaymentError(error) {
        console.error("GoLocalLink payment error:", error);
        this.notification.add(
            error.message || _t("Payment failed. Please try again."),
            { type: "danger" }
        );
        this.selfOrder.paymentError = true;

        // Reset to method selection
        this.state.selection = true;
        this.state.paymentMethodId = null;
    },

    /**
     * Cancel payment button handler
     */
    async onCancelPayment() {
        if (!this.golocalLinkPayment) {
            console.warn("GoLocalLink payment service not available");
            return;
        }

        try {
            await this.golocalLinkPayment.cancelPayment();

            // Reset to method selection
            this.state.selection = true;
            this.state.paymentMethodId = null;
        } catch (error) {
            console.error("Failed to cancel payment:", error);
            this.notification.add(_t("Failed to cancel payment"), { type: "danger" });
        }
    },

    /**
     * Force check payment status button handler
     */
    async onForceCheckStatus() {
        if (!this.golocalLinkPayment) {
            console.warn("GoLocalLink payment service not available");
            return;
        }

        try {
            const result = await this.golocalLinkPayment.getTransactionStatus();

            if (result.status === 'approved') {
                // Payment was approved, complete it
                await this.onPaymentComplete(result.data);
            } else if (result.status === 'cancelled') {
                // Payment was cancelled
                this.notification.add(_t("Payment was cancelled"), { type: "warning" });
                this.golocalLinkPayment.paymentStatus.active = false;
                this.state.selection = true;
                this.state.paymentMethodId = null;
            } else {
                // Still in progress
                this.notification.add(
                    _t("Payment is still in progress. Please wait."),
                    { type: "info" }
                );
            }
        } catch (error) {
            console.error("Failed to check payment status:", error);
            this.notification.add(_t("Failed to check payment status"), { type: "danger" });
        }
    },
});

// Register GoLocalLinkPaymentStatus component in PaymentPage's static components
PaymentPage.components = {
    ...PaymentPage.components,
    GoLocalLinkPaymentStatus,
};
