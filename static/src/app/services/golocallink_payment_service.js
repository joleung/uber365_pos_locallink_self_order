/** @odoo-module */

import { _t } from "@web/core/l10n/translation";
import { registry } from "@web/core/registry";
import { reactive } from "@odoo/owl";
import { rpc } from "@web/core/network/rpc";

/**
 * GoLocalLink Payment Service for Kiosk Self-Ordering
 *
 * This service handles payment processing via GoLocalLink payment terminal
 * using Server-Sent Events (SSE) for real-time status updates.
 */
export const golocalLinkPaymentService = {
    dependencies: ["self_order", "notification"],

    async start(env, { self_order, notification }) {
        // Payment status state (reactive)
        const paymentStatus = reactive({
            active: false,
            status: 'idle', // idle, waiting, waitingCard, processing, done, error
            uti: null,
            amount: 0,
            eventSource: null,
            config: null,
        });

        /**
         * Check if GoLocalLink is enabled and configured
         */
        function isEnabled() {
            try {
                const config = self_order?.config;
                return !!(config &&
                       config.self_ordering_mode === 'kiosk' &&
                       config.kiosk_golocallink_enabled &&
                       config.kiosk_golocallink_url &&
                       config.kiosk_golocallink_termid);
            } catch (e) {
                console.warn("Error checking GoLocalLink status:", e);
                return false;
            }
        }

        /**
         * Convert amount to smallest currency unit (e.g., £10.50 → 1050 pence)
         */
        function convertAmountToSmallestUnit(amount, currency) {
            const decimalPlaces = currency.decimal_places || 2;
            const multiplier = Math.pow(10, decimalPlaces);
            return Math.round(amount * multiplier);
        }

        /**
         * Mask sensitive payment data for logging (PCI DSS compliance)
         */
        function maskSensitiveData(data) {
            if (!data || typeof data !== 'object') return data;

            const masked = { ...data };

            // Mask card BIN (first 6 digits)
            if (masked.bank_id_no) {
                masked.bank_id_no = '******';
            }

            // Mask last 4 digits
            if (masked.card_no_4digit) {
                masked.card_no_4digit = '****';
            }

            // Mask auth code
            if (masked.auth_code) {
                masked.auth_code = '[MASKED]';
            }

            return masked;
        }

        /**
         * Debug logging (only when debug mode enabled)
         */
        function debug(message, data = null) {
            const config = self_order.config;
            if (config && config.kiosk_pdq_debug_mode) {
                if (data) {
                    console.log(`[GoLocalLink Kiosk] ${message}`, maskSensitiveData(data));
                } else {
                    console.log(`[GoLocalLink Kiosk] ${message}`);
                }
            }
        }

        /**
         * Initiate payment with GoLocalLink
         *
         * @param {Object} order - POS order object
         * @param {Number} amount - Payment amount
         * @returns {Promise<Object>} Payment initiation result with UTI
         */
        async function initiatePayment(order, amount) {
            debug('Initiating payment', { order_id: order.id, amount });

            const config = self_order.config;

            // Validate configuration
            if (!isEnabled()) {
                throw new Error(_t('GoLocalLink is not enabled or not properly configured'));
            }

            // Set status to waiting
            paymentStatus.status = 'waiting';
            paymentStatus.active = true;
            paymentStatus.amount = amount;
            paymentStatus.config = config;

            try {
                // Call backend to initiate payment
                const result = await rpc('/kiosk/golocallink/payment/' + config.id, {
                    order_data: order.serializeForORM(),
                    access_token: self_order.access_token,  // Config's access token for authorization
                });

                debug('Payment initiated', result);

                paymentStatus.uti = result.uti;

                return result;
            } catch (error) {
                paymentStatus.active = false;
                paymentStatus.status = 'idle';
                debug('Payment initiation failed', { error: error.message });
                throw error;
            }
        }

        /**
         * Connect to SSE stream for payment status updates
         *
         * @param {String} uti - Universal Transaction Identifier
         * @param {Function} onStatusUpdate - Callback for status updates
         * @param {Function} onComplete - Callback when payment completes
         * @param {Function} onError - Callback for errors
         * @returns {Promise<void>}
         */
        async function connectSSE(uti, onStatusUpdate, onComplete, onError) {
            debug('Connecting to SSE stream', { uti });

            const config = self_order.config;
            const eventSource = new EventSource(
                `/kiosk/golocallink/events/${uti}?config_id=${config.id}`
            );

            paymentStatus.eventSource = eventSource;
            paymentStatus.status = 'waitingCard';

            // Handle SSE messages
            eventSource.onmessage = (event) => {
                try {
                    const data = JSON.parse(event.data);
                    debug('SSE event received', data);

                    const statusCode = data.status_code;

                    // Update status based on status code
                    if (statusCode === 'connected') {
                        paymentStatus.status = 'waitingCard';
                        if (onStatusUpdate) onStatusUpdate('waitingCard');
                    } else if (statusCode === '206') {
                        // Transaction in progress on terminal
                        paymentStatus.status = 'processing';
                        if (onStatusUpdate) onStatusUpdate('processing');
                    } else if (statusCode === '200A') {
                        // APPROVED
                        paymentStatus.status = 'done';
                        if (onStatusUpdate) onStatusUpdate('done');

                        // Extract transaction data
                        const transactionData = {
                            uti: data.uti,
                            bank_id_no: data.bank_id_no,
                            card_no_4digit: data.card_no_4digit,
                            auth_code: data.auth_code,
                            cardholder_receipt: data.cardholder_receipt,
                        };

                        // Close SSE connection
                        eventSource.close();
                        paymentStatus.eventSource = null;

                        debug('Payment approved');

                        // Call completion callback
                        if (onComplete) onComplete(transactionData);
                    } else if (statusCode === '200N') {
                        // DECLINED or CANCELLED
                        paymentStatus.status = 'error';
                        eventSource.close();
                        paymentStatus.eventSource = null;

                        debug('Payment declined');

                        const error = new Error(_t('Payment was declined or cancelled'));
                        if (onError) onError(error);
                    } else if (statusCode === '000') {
                        // Reset signal - connection will close
                        debug('Reset signal received');
                    }
                } catch (err) {
                    debug('Error parsing SSE event', { error: err.message });
                    console.error('Error parsing SSE event:', err);
                }
            };

            // Handle SSE errors
            eventSource.onerror = (error) => {
                debug('SSE connection error', { error });
                paymentStatus.status = 'error';
                eventSource.close();
                paymentStatus.eventSource = null;

                if (onError) {
                    onError(new Error(_t('Connection to payment terminal lost')));
                }
            };
        }

        /**
         * Cancel in-progress payment
         *
         * @returns {Promise<void>}
         */
        async function cancelPayment() {
            debug('Cancelling payment', { uti: paymentStatus.uti });

            const config = self_order.config;

            try {
                // Close SSE connection if active
                if (paymentStatus.eventSource) {
                    paymentStatus.eventSource.close();
                    paymentStatus.eventSource = null;
                }

                // Call backend to cancel
                await rpc('/kiosk/golocallink/cancel', {
                    config_id: config.id,
                });

                // Reset status
                paymentStatus.active = false;
                paymentStatus.status = 'idle';
                paymentStatus.uti = null;

                debug('Payment cancelled');

                notification.add(_t('Payment cancelled'), { type: 'warning' });
            } catch (error) {
                debug('Cancel failed', { error: error.message });
                console.error('Failed to cancel payment:', error);
                throw error;
            }
        }

        /**
         * Get transaction status (Force Done)
         * Used when SSE connection lost
         *
         * @returns {Promise<Object>} Transaction status
         */
        async function getTransactionStatus() {
            const uti = paymentStatus.uti;
            debug('Getting transaction status', { uti });

            const config = self_order.config;

            try {
                const result = await rpc('/kiosk/golocallink/status/' + uti, {
                    config_id: config.id,
                });

                debug('Transaction status', result);

                return result;
            } catch (error) {
                debug('Status check failed', { error: error.message });
                console.error('Failed to get transaction status:', error);
                throw error;
            }
        }

        /**
         * Complete payment on backend
         *
         * @param {Number} orderId - Order ID
         * @param {String} accessToken - Order access token
         * @param {Object} transactionData - Transaction metadata from GoLocalLink
         * @returns {Promise<Object>} Completion result
         */
        async function completePayment(orderId, accessToken, transactionData) {
            debug('Completing payment on backend', { order_id: orderId });

            try {
                const result = await rpc('/kiosk/golocallink/complete', {
                    order_id: orderId,
                    access_token: accessToken,
                    transaction_data: transactionData,
                });

                debug('Payment completed', result);

                // Reset status
                paymentStatus.active = false;
                paymentStatus.status = 'idle';
                paymentStatus.uti = null;

                notification.add(_t('Payment successful!'), { type: 'success' });

                return result;
            } catch (error) {
                debug('Payment completion failed', { error: error.message });
                console.error('Failed to complete payment:', error);
                throw error;
            }
        }

        return {
            paymentStatus,
            isEnabled,
            initiatePayment,
            connectSSE,
            cancelPayment,
            getTransactionStatus,
            completePayment,
            convertAmountToSmallestUnit,
            debug,
        };
    },
};

registry.category("services").add("golocallink_payment", golocalLinkPaymentService);
