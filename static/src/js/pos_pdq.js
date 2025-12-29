/** @odoo-module */

import { PaymentScreen } from "@point_of_sale/app/screens/payment_screen/payment_screen";
import { patch } from "@web/core/utils/patch";
import { _t } from "@web/core/l10n/translation";
import { useService } from "@web/core/utils/hooks";
import { AlertDialog } from "@web/core/confirmation_dialog/confirmation_dialog";
import { useState } from "@odoo/owl";
import { PDQPaymentStatus } from "./pdq_payment_status";

patch(PaymentScreen, {
    components: {
        ...PaymentScreen.components,
        PDQPaymentStatus,
    },
});

patch(PaymentScreen.prototype, {
    setup() {
        super.setup(...arguments);
        this.notification = useService("notification");
        this.dialog = useService("dialog");

        // Payment status tracking for UI display
        this.pdqPaymentStatus = useState({
            active: false,
            status: 'idle',      // idle, waiting, waitingCard, processing, done, error
            uti: null,
            amount: 0,
            eventSource: null    // Store EventSource reference for cancellation
        });
    },

    /**
     * Helper function to log debug messages only when debug mode is enabled
     * @param {string} message - Log message
     * @param {object} data - Data to log (sensitive fields will be masked)
     */
    _pdqDebug(message, data = null) {
        if (this.pos.config.pdq_debug_mode) {
            if (data) {
                const maskedData = this._maskSensitiveData(data);
                console.log(message, maskedData);
            } else {
                console.log(message);
            }
        }
    },

    /**
     * Mask sensitive payment data in logs
     * @param {object} data - Data object potentially containing sensitive fields
     * @returns {object} - Data with sensitive fields masked
     */
    _maskSensitiveData(data) {
        if (!data || typeof data !== 'object') {
            return data;
        }

        const masked = { ...data };

        // Mask card BIN (first 6 digits) - show as ******
        if (masked.bank_id_no || masked.cardBin || masked.pdq_card_bin) {
            const binField = masked.bank_id_no || masked.cardBin || masked.pdq_card_bin;
            masked.bank_id_no = binField ? '******' : binField;
            masked.cardBin = binField ? '******' : binField;
            masked.pdq_card_bin = binField ? '******' : binField;
        }

        // Mask last 4 digits - show as ****
        if (masked.card_no_4digit || masked.cardLast4 || masked.card_no) {
            const last4Field = masked.card_no_4digit || masked.cardLast4 || masked.card_no;
            masked.card_no_4digit = last4Field ? '****' : last4Field;
            masked.cardLast4 = last4Field ? '****' : last4Field;
            masked.card_no = last4Field ? '****' : last4Field;
        }

        // Mask authorization code - show as [MASKED]
        if (masked.auth_code || masked.authCode || masked.payment_method_authcode) {
            masked.auth_code = '[MASKED]';
            masked.authCode = '[MASKED]';
            masked.payment_method_authcode = '[MASKED]';
        }

        // Keep UTI/transaction_id visible (needed for troubleshooting, not PCI sensitive)
        // Keep terminal ID visible (configuration data, not payment data)
        // Keep amounts, currency, status codes visible (not sensitive)

        return masked;
    },

    /**
     * Process PDQ payment using Server-Sent Events (SSE)
     * According to golocallink API v1.0.0
     */
    async BtnPDQ() {
        const self = this;
        const order = this.currentOrder;

        // Note: ServiceWorker is now configured to skip GoLocalLink SSE endpoints
        // See: controllers/main.py and static/src/app/service_worker.js
        // No need to unregister ServiceWorker - offline mode is preserved!

        // Get golocallink server URL from POS config (defaults to localhost:8080)
        const baseUrl = this.pos.config.golocallink_url || 'https://127.0.0.1:8443';
        const terminalId = this.pos.config.golocallink_termid;

        // Validate terminal ID is configured
        if (!terminalId) {
            this.dialog.add(AlertDialog, {
                title: _t("Configuration Error"),
                body: _t("Terminal ID is not configured. Please configure the Terminal ID in POS Settings > GoLocalLink PDQ."),
            });
            return;
        }

        // Validate and convert payment amount using currency-aware logic
        const amountDue = order.totalDue;

        // Validation 1: Amount must be greater than 0
        if (amountDue <= 0) {
            this.dialog.add(AlertDialog, {
                title: _t("Invalid Amount"),
                body: _t("Payment amount must be greater than zero."),
            });
            return;
        }

        // Get currency decimal places (defaults to 2 for GBP, USD, EUR, etc.)
        const decimalPlaces = this.pos.currency.decimal_places !== undefined ?
                              this.pos.currency.decimal_places : 2;

        // Validation 2: Maximum amount check to prevent excessive charges
        // Set to 999999.99 for most currencies (adjusts based on decimal places)
        const maxAmount = 999999.99;
        if (amountDue > maxAmount) {
            const currencySymbol = this.pos.currency.symbol || '';
            const formattedMax = maxAmount.toFixed(decimalPlaces);
            this.dialog.add(AlertDialog, {
                title: _t("Amount Too Large"),
                body: _t("Payment amount exceeds maximum allowed (%s%s).", currencySymbol, formattedMax),
            });
            return;
        }

        // Convert to smallest currency unit using currency-aware logic
        // For GBP (2 decimal places): pounds to pence (multiply by 10^2 = 100)
        // For JPY (0 decimal places): yen stays as yen (multiply by 10^0 = 1)
        // For currencies with 3 decimal places: multiply by 10^3 = 1000
        const multiplier = Math.pow(10, decimalPlaces);
        const amountSmallestUnit = Math.round(amountDue * multiplier);

        // Get order reference for transaction tracking
        const orderRef = order.name || '';

        this._pdqDebug('[PDQ] Initiating payment:', {
            amount: amountDue,
            currency: this.pos.currency.name,
            decimalPlaces: decimalPlaces,
            multiplier: multiplier,
            amountSmallestUnit: amountSmallestUnit,
            reference: orderRef,
            server: baseUrl,
            terminalId: terminalId
        });

        // DEBUG: Check if payment line exists
        this._pdqDebug('[PDQ DEBUG] Selected payment line:', order.selected_paymentline);
        this._pdqDebug('[PDQ DEBUG] All payment lines:', order.payment_ids);

        // DEBUG: Check if pos.payment model has our custom fields
        if (this.pos.data && this.pos.data.models && this.pos.data.models['pos.payment']) {
            this._pdqDebug('[PDQ DEBUG] pos.payment model fields:', this.pos.data.models['pos.payment'].fields);
        } else {
            this._pdqDebug('[PDQ DEBUG] WARNING: Cannot access pos.payment model fields');
        }

        // Ensure we have a payment line for this payment
        // If no payment line is selected, we need to create one first
        if (!order.selected_paymentline) {
            this._pdqDebug('[PDQ DEBUG] No payment line selected, creating one...');

            // Get payment methods from the correct property in Odoo 19
            const paymentMethods = this.pos.models['pos.payment.method']?.getAll() ||
                                  this.pos.payment_methods ||
                                  [];

            this._pdqDebug('[PDQ DEBUG] Available payment methods:', paymentMethods);

            // Find a PDQ/Card payment method, or fallback to any available method
            let paymentMethod = paymentMethods.find(
                pm => pm.name && (pm.name.toLowerCase().includes('pdq') ||
                                 pm.name.toLowerCase().includes('card') ||
                                 pm.use_payment_terminal)
            );

            // If no suitable method found, use the first available payment method
            if (!paymentMethod && paymentMethods.length > 0) {
                paymentMethod = paymentMethods[0];
            }

            if (!paymentMethod) {
                this.dialog.add(AlertDialog, {
                    title: _t("Configuration Error"),
                    body: _t("No payment method available. Please configure payment methods in POS settings."),
                });
                return;
            }

            this._pdqDebug('[PDQ DEBUG] Using payment method:', paymentMethod.name);

            // Create a new payment line with the full amount due
            this.addNewPaymentLine(paymentMethod);

            // After creating, get the last payment line (the one just created)
            const paymentLines = order.payment_ids;
            const lastPaymentLine = paymentLines.length > 0 ? paymentLines[paymentLines.length - 1] : null;

            this._pdqDebug('[PDQ DEBUG] Payment line created:', lastPaymentLine);
            this._pdqDebug('[PDQ DEBUG] Selected payment line after creation:', order.selected_paymentline);

            // If selected_paymentline is still undefined but we have a payment line, use the last one
            if (!order.selected_paymentline && lastPaymentLine) {
                this._pdqDebug('[PDQ DEBUG] Selected payment line is undefined, using last payment line');
                // Store reference to use later
                this._pdqPaymentLine = lastPaymentLine;
            }
        }

        // Set initial payment status - OWL component will automatically show
        this.pdqPaymentStatus.active = true;
        this.pdqPaymentStatus.status = 'waiting';
        this.pdqPaymentStatus.amount = amountDue;
        this.pdqPaymentStatus.uti = null;

        try {
            // Step 1: Initiate transaction and get UTI
            this._pdqDebug('[PDQ] Initiating transaction to:', baseUrl);

            let initResponse;
            try {
                initResponse = await fetch(`${baseUrl}/api/sse/txn/sale`, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({
                        termid: terminalId,
                        amttxn: amountSmallestUnit,
                        ref: orderRef
                    })
                });
            } catch (fetchError) {
                console.error('[PDQ] Network error during fetch:', fetchError);
                this.dialog.add(AlertDialog, {
                    title: _t("Connection Failed"),
                    body: _t("Cannot connect to payment server at %s. Please check:\n1. Is the golocallink server running?\n2. Is the server URL correct in POS settings?\n3. Are there any CORS or network issues?\n\nError: %s", baseUrl, fetchError.message),
                });
                throw fetchError;
            }

            if (!initResponse.ok) {
                const errorData = await initResponse.json().catch(() => ({}));
                console.error('[PDQ] Server returned error status:', initResponse.status, errorData);
                throw new Error(errorData.error || `Server returned status ${initResponse.status}`);
            }

            const responseData = await initResponse.json();

            // Log the full response for debugging
            this._pdqDebug('[PDQ] Server response:', responseData);

            // Validate required fields in transaction init response
            // Note: The actual golocallink API returns: {uti, amountTrans, transType, amountCashback, amountGratuity}
            // It does NOT include a "status" field - that was in the old API documentation
            if (!responseData.uti || typeof responseData.uti !== 'string') {
                console.error('[PDQ] Invalid transaction response - missing or invalid UTI:', this._maskSensitiveData(responseData));
                this.dialog.add(AlertDialog, {
                    title: _t("Invalid Server Response"),
                    body: _t("The payment server response is missing a transaction ID (UTI). Response received: %s", JSON.stringify(responseData)),
                });
                throw new Error('Invalid response from payment server: missing transaction ID (UTI)');
            }

            const { uti, amountTrans, transType } = responseData;
            this._pdqDebug('[PDQ] Transaction initiated:', { uti, amountTrans, transType });

            // Update status with UTI - OWL component will automatically update
            this.pdqPaymentStatus.uti = uti;
            this.pdqPaymentStatus.status = 'waitingCard';

            // Step 2: Open SSE connection to receive transaction updates
            const eventSource = new EventSource(`${baseUrl}/api/events/${uti}`);
            this.pdqPaymentStatus.eventSource = eventSource;  // Store for cancellation

            eventSource.onmessage = (event) => {
                try {
                    const data = JSON.parse(event.data);

                    // Validate SSE event data has status_code
                    if (!data || typeof data !== 'object') {
                        console.error('[PDQ] Invalid SSE event - not an object:', event.data);
                        return;
                    }

                    if (!data.status_code) {
                        console.error('[PDQ] Invalid SSE event - missing status_code:', this._maskSensitiveData(data));
                        return;
                    }

                    const statusCode = data.status_code;

                    this._pdqDebug('[PDQ] Status update:', data);

                    switch(statusCode) {
                        case 'connected':
                            this._pdqDebug('[PDQ] Connected to payment stream');
                            this.pdqPaymentStatus.status = 'waitingCard';
                            break;

                        case '206':
                            this._pdqDebug('[PDQ] Transaction in progress on terminal');
                            this.pdqPaymentStatus.status = 'processing';
                            break;

                        case '200A':
                            // Transaction approved
                            this.pdqPaymentStatus.status = 'done';

                            // Validate approval data has required card fields
                            if (!data.uti) {
                                console.error('[PDQ] Approval data missing UTI:', this._maskSensitiveData(data));
                                this.dialog.add(AlertDialog, {
                                    title: _t("Incomplete Response"),
                                    body: _t("Payment approved but response is incomplete - missing transaction ID. Please check payment records."),
                                });
                                this.pdqPaymentStatus.active = false;
                                this.pdqPaymentStatus.eventSource = null;
                                eventSource.close();
                                return;
                            }

                            if (!data.bank_id_no || !data.card_no_4digit || !data.auth_code) {
                                console.error('[PDQ] Approval data missing card fields:', this._maskSensitiveData({
                                    uti: data.uti,
                                    bank_id_no: data.bank_id_no,
                                    card_no_4digit: data.card_no_4digit,
                                    auth_code: data.auth_code
                                }));
                                this.notification.add(
                                    _t("Payment approved but card details are incomplete. Transaction ID: %s", data.uti),
                                    { type: "warning" }
                                );
                                // Continue anyway since payment was approved
                            }

                            this._pdqDebug('[PDQ] Payment approved!', {
                                uti: data.uti,
                                cardBin: data.bank_id_no,
                                cardLast4: data.card_no_4digit,
                                authCode: data.auth_code,
                                ticket: data.cardholder_receipt || ''
                            });

                            // Store transaction data in the payment line
                            // Using standard pos.payment fields where possible:
                            // - transaction_id for UTI
                            // - card_no for last 4 digits
                            // - payment_method_authcode for authorization code
                            // - ticket for merchant receipt
                            // - pdq_card_bin for Card BIN (custom field)
                            const paymentLine = order.selected_paymentline || this._pdqPaymentLine;

                            if (paymentLine) {
                                this._pdqDebug('[PDQ DEBUG] Before update - payment line:', paymentLine);
                                this._pdqDebug('[PDQ DEBUG] Payment line fields available:', Object.keys(paymentLine));

                                // Try using .update() first, fallback to direct assignment if it fails
                                try {
                                    paymentLine.update({
                                        transaction_id: data.uti,
                                        pdq_card_bin: data.bank_id_no,
                                        card_no: data.card_no_4digit,
                                        payment_method_authcode: data.auth_code,
                                        ticket: data.cardholder_receipt || ''
                                    });
                                    this._pdqDebug('[PDQ DEBUG] Payment line updated via .update()');
                                } catch (updateError) {
                                    this._pdqDebug('[PDQ DEBUG] .update() failed, trying direct assignment:', updateError);
                                    // Fallback to direct assignment
                                    paymentLine.transaction_id = data.uti;
                                    paymentLine.pdq_card_bin = data.bank_id_no;
                                    paymentLine.card_no = data.card_no_4digit;
                                    paymentLine.payment_method_authcode = data.auth_code;
                                    paymentLine.ticket = data.cardholder_receipt || '';
                                    this._pdqDebug('[PDQ DEBUG] Payment line updated via direct assignment');
                                }

                                this._pdqDebug('[PDQ DEBUG] After update - payment line:', paymentLine);
                                this._pdqDebug('[PDQ DEBUG] PDQ fields set:', {
                                    transaction_id: paymentLine.transaction_id,
                                    pdq_card_bin: paymentLine.pdq_card_bin,
                                    card_no: paymentLine.card_no,
                                    payment_method_authcode: paymentLine.payment_method_authcode,
                                    ticket: paymentLine.ticket
                                });
                            } else {
                                console.error('[PDQ DEBUG] ERROR: No payment line available to store transaction data!');
                            }

                            // Validate and complete the order
                            self.validateOrder();

                            // Reset status and close connection
                            setTimeout(() => {
                                this.pdqPaymentStatus.active = false;
                                this.pdqPaymentStatus.eventSource = null;
                            }, 2000); // Show success for 2 seconds
                            eventSource.close();
                            break;

                        case '200N':
                            // Transaction declined or canceled
                            this._pdqDebug('[PDQ] Payment declined or canceled');
                            this.pdqPaymentStatus.status = 'error';
                            this.pdqPaymentStatus.active = false;
                            this.pdqPaymentStatus.eventSource = null;
                            this.dialog.add(AlertDialog, {
                                title: _t("Payment Declined"),
                                body: _t("The payment was declined or canceled on the terminal. Please try again or use a different payment method."),
                            });
                            eventSource.close();
                            break;

                        case '000':
                            // Reset signal - connection will close
                            this._pdqDebug('[PDQ] Transaction complete, resetting');
                            eventSource.close();
                            break;

                        default:
                            this._pdqDebug('[PDQ] Unknown status code:', statusCode);
                    }
                } catch (parseError) {
                    console.error('[PDQ] Error parsing SSE message:', parseError);
                    this._pdqDebug('[PDQ] Raw event data:', event.data);
                    // Don't alert on parse errors - may be temporary or expected
                }
            };

            eventSource.onerror = (error) => {
                console.error('[PDQ] SSE connection error:', error);
                this.pdqPaymentStatus.status = 'error';
                this.pdqPaymentStatus.active = false;
                this.pdqPaymentStatus.eventSource = null;
                eventSource.close();

                this.dialog.add(AlertDialog, {
                    title: _t("Connection Error"),
                    body: _t("Lost connection to payment terminal.\n\nPlease check if the payment was processed and retry if necessary.\n\nIf this error persists, check:\n1. Is the GoLocalLink server running?\n2. Is the terminal responding?\n3. Network connectivity"),
                });
            };

        } catch (error) {
            console.error('[PDQ] Payment error:', error);
            this.pdqPaymentStatus.status = 'error';
            this.pdqPaymentStatus.active = false;
            this.pdqPaymentStatus.eventSource = null;
            this.dialog.add(AlertDialog, {
                title: _t("Payment Failed"),
                body: _t("Payment failed: %s", error.message),
            });
        }
    },

    /**
     * Cancel PDQ payment in progress
     * Closes SSE connection and resets status
     */
    async cancelPDQPayment() {
        if (!this.pdqPaymentStatus.eventSource) {
            return;
        }

        const baseUrl = this.pos.config.golocallink_url || 'https://127.0.0.1:8443';

        try {
            // Send cancel request to terminal
            this._pdqDebug('[PDQ] Sending cancel request to terminal');
            const response = await fetch(`${baseUrl}/api/txn/cancel`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
            });

            if (response.ok) {
                const data = await response.json();
                this._pdqDebug('[PDQ] Cancel response:', data);
            } else {
                console.warn('[PDQ] Cancel request failed with status:', response.status);
            }
        } catch (error) {
            console.error('[PDQ] Error sending cancel request:', error);
            // Continue with cleanup even if cancel request fails
        }

        // Close SSE connection
        this.pdqPaymentStatus.eventSource.close();

        // Reset status
        this.pdqPaymentStatus.active = false;
        this.pdqPaymentStatus.status = 'idle';
        this.pdqPaymentStatus.eventSource = null;

        // Show notification
        this.notification.add(
            _t("Payment cancelled by user"),
            { type: "warning" }
        );

        // Optional: Remove payment line if it was created
        const paymentLine = this.currentOrder.selected_paymentline;
        if (paymentLine && paymentLine.amount === this.pdqPaymentStatus.amount) {
            this.currentOrder.remove_paymentline(paymentLine);
        }
    },

    /**
     * Force Done - Retrieve transaction status from GoLocalLink API
     * Used when SSE connection fails but terminal may have processed payment
     */
    async forceDonePDQPayment() {
        if (!this.pdqPaymentStatus.uti) {
            this.dialog.add(AlertDialog, {
                title: _t("Cannot Force Done"),
                body: _t("No transaction ID available. Payment was not initiated."),
            });
            return;
        }

        const uti = this.pdqPaymentStatus.uti;
        const baseUrl = this.pos.config.golocallink_url || 'https://127.0.0.1:8443';

        try {
            // Fetch transaction status from GoLocalLink
            const response = await fetch(`${baseUrl}/api/txn/${uti}`);

            if (!response.ok) {
                if (response.status === 500) {
                    const errorData = await response.json().catch(() => ({}));
                    throw new Error(errorData.error || 'Database connection failed');
                }
                throw new Error(`Server returned status ${response.status}`);
            }

            const txnData = await response.json();

            // Check response format - could be completed transaction or in-progress
            if (txnData.status_code === '206') {
                // Transaction still in progress
                this.dialog.add(AlertDialog, {
                    title: _t("Transaction In Progress"),
                    body: _t("Transaction is still being processed on the terminal. Please wait or check the terminal display.\n\nTransaction ID: %s", uti),
                });
                return;
            }

            // Transaction completed - check if approved or cancelled
            if (txnData.transApproved === true) {
                // Transaction was approved - extract card details and store data
                const paymentLine = this.currentOrder.selected_paymentline || this._pdqPaymentLine;

                if (paymentLine) {
                    // Extract BIN (first 6 digits) and last 4 digits from masked PAN
                    // Format: "453212******9012"
                    const pan = txnData.primaryAccountNumber || '';
                    const cardBin = pan.substring(0, 6);
                    const cardLast4 = pan.substring(pan.length - 4);

                    paymentLine.transaction_id = txnData.uti;
                    paymentLine.pdq_card_bin = cardBin;
                    paymentLine.card_no = cardLast4;
                    paymentLine.payment_method_authcode = txnData.authCode;
                    paymentLine.ticket = ''; // Receipt not available in this response

                    this._pdqDebug('[PDQ DEBUG] Force Done - Payment line updated:', {
                        uti: txnData.uti,
                        cardBin: cardBin,
                        cardLast4: cardLast4,
                        authCode: txnData.authCode
                    });
                }

                // Complete order
                this.validateOrder();

                // Show success
                this.notification.add(
                    _t("Payment retrieved and completed successfully"),
                    { type: "success" }
                );

            } else if (txnData.transCancelled === true) {
                // Transaction was cancelled/declined
                this.dialog.add(AlertDialog, {
                    title: _t("Payment Declined"),
                    body: _t("The transaction was declined or cancelled on the terminal.\n\nTransaction ID: %s", uti),
                });
            } else {
                // Unknown transaction state
                this.dialog.add(AlertDialog, {
                    title: _t("Transaction Status Unknown"),
                    body: _t("Unable to determine transaction status. Response: %s\n\nTransaction ID: %s\n\nPlease check the terminal display or transaction records.",
                        JSON.stringify(txnData), uti),
                });
            }

        } catch (error) {
            console.error('[PDQ] Force Done error:', error);
            this.dialog.add(AlertDialog, {
                title: _t("Cannot Retrieve Transaction"),
                body: _t("Failed to retrieve transaction information from server.\n\nTransaction ID: %s\n\nError: %s\n\nPlease check:\n1. Is the GoLocalLink server running?\n2. Is the network connection stable?\n3. Check the terminal display for transaction status.",
                    uti, error.message),
            });
        } finally {
            // Reset status
            this.pdqPaymentStatus.active = false;
            this.pdqPaymentStatus.status = 'idle';
            this.pdqPaymentStatus.eventSource = null;
        }
    },
});
