/** @odoo-module */

import { PosData } from "@point_of_sale/app/services/data_service";
import { patch } from "@web/core/utils/patch";

patch(PosData.prototype, {
    async loadInitialData() {
        const data = await super.loadInitialData(...arguments);

        // Debug: Log what data we received from backend
        console.log('[GoLocalLink Kiosk] Data received from backend:', {
            hasPaymentMethods: 'pos.payment.method' in data,
            paymentMethodCount: data['pos.payment.method']?.length || 0,
            paymentMethods: data['pos.payment.method'],
            configData: data['pos.config']?.[0],
        });

        return data;
    },
});
