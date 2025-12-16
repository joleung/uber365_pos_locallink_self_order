/** @odoo-module */

import { SelfOrder } from "@pos_self_order/app/services/self_order_service";
import { patch } from "@web/core/utils/patch";

patch(SelfOrder.prototype, {
    /**
     * Override to include all payment methods when GoLocalLink is enabled for kiosk.
     *
     * The base implementation only allows payment methods with use_payment_terminal
     * in ['adyen', 'stripe']. We extend this to also allow all payment methods
     * when GoLocalLink is enabled.
     */
    filterPaymentMethods(pms) {
        if (this.config.self_ordering_mode === "kiosk") {
            // If GoLocalLink is enabled, don't filter payment methods
            if (this.config.kiosk_golocallink_enabled) {
                console.log('[GoLocalLink Kiosk] filterPaymentMethods - GoLocalLink enabled, returning all payment methods:', pms);
                return pms;
            }

            // Otherwise, use the default adyen/stripe filter
            console.log('[GoLocalLink Kiosk] filterPaymentMethods - Using default adyen/stripe filter');
            return pms.filter((rec) => ["adyen", "stripe"].includes(rec.use_payment_terminal));
        }

        // Mobile mode: no payment methods
        return [];
    },
});
