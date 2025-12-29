# Implementation Plan: User Notification System (Issue #8)

## Overview
Replace all `alert()` calls and implement TODOs with Odoo's native notification/popup system to provide better user feedback during PDQ payment processing.

## Current State Analysis

### Existing alert() calls in pos_pdq.js:
1. **Line 80**: Terminal ID not configured
2. **Line 89**: Payment amount must be greater than zero
3. **Line 102**: Payment amount exceeds maximum
4. **Line 163**: No payment method available
5. **Line 261**: Payment approved but response incomplete
6. **Line 273**: Payment approved but card details incomplete
7. **Line 364**: Lost connection to payment terminal
8. **Line 369**: Payment failed error

### TODO comments to implement:
1. **Line 247**: Show "Connecting to terminal..." notification (status: 'connected')
2. **Line 252**: Show "Processing payment on terminal..." notification (status: '206')
3. **Line 341**: Show "Payment declined" error notification (status: '200N')

## Technical Approach

### Services Required
We need to add two Odoo services to the PaymentScreen patch:
- **notification** service: For transient toast-style messages (info, success, warnings)
- **dialog** service: For modal dialogs that require user acknowledgment (errors)

### Import Statements Needed
```javascript
import { useService } from "@web/core/utils/hooks";
import { AlertDialog } from "@web/core/confirmation_dialog/confirmation_dialog";
```

### Pattern Decision Matrix

| Scenario | Type | Rationale |
|----------|------|-----------|
| Connecting to terminal | notification (info) | Transient status update |
| Processing payment | notification (info) | Transient status update |
| Payment successful | Auto-validated | No notification needed (order validates) |
| Payment declined | AlertDialog | Requires acknowledgment, blocking action |
| Connection error | AlertDialog | Critical error, requires acknowledgment |
| Validation errors | AlertDialog | Prevents incorrect action, needs acknowledgment |
| Config errors | AlertDialog | Setup issue, needs immediate attention |

## Implementation Steps

### Step 1: Add Services to PaymentScreen Patch

**Location**: Top of `patch(PaymentScreen.prototype, {`
**Action**: Add setup method to initialize services

```javascript
patch(PaymentScreen.prototype, {
    setup() {
        super.setup(...arguments);
        this.notification = useService("notification");
        this.dialog = useService("dialog");
    },

    // ... existing methods
});
```

**Note**: PaymentScreen may already have a setup() method, so we need to check and extend it properly.

### Step 2: Implement TODO #1 - "Connecting to terminal..." (Line 247)

**Current code**:
```javascript
case 'connected':
    this._pdqDebug('[PDQ] Connected to payment stream');
    // TODO: Show "Connecting to terminal..." notification
    break;
```

**New code**:
```javascript
case 'connected':
    this._pdqDebug('[PDQ] Connected to payment stream');
    this.notification.add(
        _t("Connecting to terminal..."),
        { type: "info" }
    );
    break;
```

**Reasoning**: Informational transient message, doesn't block user

### Step 3: Implement TODO #2 - "Processing payment..." (Line 252)

**Current code**:
```javascript
case '206':
    this._pdqDebug('[PDQ] Transaction in progress on terminal');
    // TODO: Show "Processing payment on terminal..." notification
    break;
```

**New code**:
```javascript
case '206':
    this._pdqDebug('[PDQ] Transaction in progress on terminal');
    const currencySymbol = this.pos.currency.symbol || '';
    const formattedAmount = this.env.utils.formatCurrency(this.currentOrder.totalDue, false);
    this.notification.add(
        _t("Processing payment of %s%s on terminal...", currencySymbol, formattedAmount),
        { type: "info" }
    );
    break;
```

**Reasoning**: Shows amount being charged as per acceptance criteria

### Step 4: Implement TODO #3 - Payment Declined (Line 341)

**Current code**:
```javascript
case '200N':
    // Transaction declined or canceled
    this._pdqDebug('[PDQ] Payment declined or canceled');
    // TODO: Show "Payment declined" error notification
    eventSource.close();
    break;
```

**New code**:
```javascript
case '200N':
    // Transaction declined or canceled
    this._pdqDebug('[PDQ] Payment declined or canceled');
    this.dialog.add(AlertDialog, {
        title: _t("Payment Declined"),
        body: _t("The payment was declined or canceled on the terminal. Please try again or use a different payment method."),
    });
    eventSource.close();
    break;
```

**Reasoning**: Blocking error dialog - user needs to acknowledge and take action

### Step 5: Replace alert() - Terminal ID Not Configured (Line 80)

**Current code**:
```javascript
if (!terminalId) {
    alert(_t('Terminal ID is not configured. Please configure the Terminal ID in POS Settings > GoLocalLink PDQ.'));
    return;
}
```

**New code**:
```javascript
if (!terminalId) {
    this.dialog.add(AlertDialog, {
        title: _t("Configuration Error"),
        body: _t("Terminal ID is not configured. Please configure the Terminal ID in POS Settings > GoLocalLink PDQ."),
    });
    return;
}
```

**Reasoning**: Configuration error, requires immediate attention

### Step 6: Replace alert() - Amount Validation Errors (Lines 89, 102)

**Current code (Line 89)**:
```javascript
if (amountDue <= 0) {
    alert(_t('Payment amount must be greater than zero'));
    return;
}
```

**New code**:
```javascript
if (amountDue <= 0) {
    this.dialog.add(AlertDialog, {
        title: _t("Invalid Amount"),
        body: _t("Payment amount must be greater than zero."),
    });
    return;
}
```

**Current code (Line 102)**:
```javascript
if (amountDue > maxAmount) {
    const currencySymbol = this.pos.currency.symbol || '';
    alert(_t(`Payment amount exceeds maximum allowed (${currencySymbol}${maxAmount.toFixed(decimalPlaces)})`));
    return;
}
```

**New code**:
```javascript
if (amountDue > maxAmount) {
    const currencySymbol = this.pos.currency.symbol || '';
    const formattedMax = maxAmount.toFixed(decimalPlaces);
    this.dialog.add(AlertDialog, {
        title: _t("Amount Too Large"),
        body: _t("Payment amount exceeds maximum allowed (%s%s).", currencySymbol, formattedMax),
    });
    return;
}
```

**Reasoning**: Validation errors preventing incorrect operations

### Step 7: Replace alert() - No Payment Method (Line 163)

**Current code**:
```javascript
if (!paymentMethod) {
    alert(_t('No payment method available. Please configure payment methods in POS settings.'));
    return;
}
```

**New code**:
```javascript
if (!paymentMethod) {
    this.dialog.add(AlertDialog, {
        title: _t("Configuration Error"),
        body: _t("No payment method available. Please configure payment methods in POS settings."),
    });
    return;
}
```

**Reasoning**: Configuration error, requires setup

### Step 8: Replace alert() - Incomplete Response Warnings (Lines 261, 273)

**Current code (Line 261)**:
```javascript
if (!data.uti) {
    console.error('[PDQ] Approval data missing UTI:', this._maskSensitiveData(data));
    alert(_t('Payment approved but response is incomplete - missing transaction ID. Please check payment records.'));
    eventSource.close();
    return;
}
```

**New code**:
```javascript
if (!data.uti) {
    console.error('[PDQ] Approval data missing UTI:', this._maskSensitiveData(data));
    this.dialog.add(AlertDialog, {
        title: _t("Incomplete Response"),
        body: _t("Payment approved but response is incomplete - missing transaction ID. Please check payment records."),
    });
    eventSource.close();
    return;
}
```

**Current code (Line 273)**:
```javascript
if (!data.bank_id_no || !data.card_no_4digit || !data.auth_code) {
    console.error('[PDQ] Approval data missing card fields:', this._maskSensitiveData({...}));
    alert(_t('Payment approved but card details are incomplete. Transaction ID: ') + data.uti);
    // Continue anyway since payment was approved
}
```

**New code**:
```javascript
if (!data.bank_id_no || !data.card_no_4digit || !data.auth_code) {
    console.error('[PDQ] Approval data missing card fields:', this._maskSensitiveData({...}));
    this.notification.add(
        _t("Payment approved but card details are incomplete. Transaction ID: %s", data.uti),
        { type: "warning" }
    );
    // Continue anyway since payment was approved
}
```

**Reasoning**: Warning but not blocking (payment continues), so notification instead of dialog

### Step 9: Replace alert() - Connection Error (Line 364)

**Current code**:
```javascript
eventSource.onerror = (error) => {
    console.error('[PDQ] SSE connection error:', error);
    eventSource.close();
    alert(_t('Lost connection to payment terminal. Please check if the payment was processed and retry if necessary.'));
};
```

**New code**:
```javascript
eventSource.onerror = (error) => {
    console.error('[PDQ] SSE connection error:', error);
    eventSource.close();
    this.dialog.add(AlertDialog, {
        title: _t("Connection Error"),
        body: _t("Lost connection to payment terminal. Please check if the payment was processed and retry if necessary."),
    });
};
```

**Reasoning**: Critical connection error, user needs to verify payment status

### Step 10: Replace alert() - General Payment Error (Line 369)

**Current code**:
```javascript
} catch (error) {
    console.error('[PDQ] Payment error:', error);
    alert(_t('Payment failed: ') + error.message);
}
```

**New code**:
```javascript
} catch (error) {
    console.error('[PDQ] Payment error:', error);
    this.dialog.add(AlertDialog, {
        title: _t("Payment Failed"),
        body: _t("Payment failed: %s", error.message),
    });
}
```

**Reasoning**: Critical error, requires acknowledgment

## Testing Plan

### Manual Test Scenarios

1. **Test Notifications During Normal Flow**:
   - Start a payment transaction
   - Verify "Connecting to terminal..." notification appears (blue, transient)
   - Verify "Processing payment..." notification appears with amount (blue, transient)
   - Complete payment successfully
   - Verify no error dialogs appear

2. **Test Payment Declined**:
   - Start payment, decline on terminal
   - Verify AlertDialog appears with "Payment Declined" title
   - Verify dialog blocks interaction until dismissed
   - Verify user can retry payment

3. **Test Validation Errors**:
   - Try payment with amount = 0
   - Verify "Invalid Amount" dialog appears
   - Try payment with terminal ID not configured
   - Verify "Configuration Error" dialog appears

4. **Test Connection Errors**:
   - Stop golocallink server
   - Attempt payment
   - Verify connection error dialog appears
   - Verify helpful error message

5. **Test All Dialogs are Modal**:
   - Trigger each error condition
   - Verify dialog blocks background interaction
   - Verify dialog can be dismissed with button
   - Verify no `alert()` browser dialogs appear

### Regression Testing

- Verify debug mode still works (`pdq_debug_mode=True`)
- Verify sensitive data masking still functions
- Verify payment flow completes successfully
- Verify transaction data stored correctly in payment line
- Verify order validation works after successful payment

## Files to Modify

### Primary File
- **`static/src/js/pos_pdq.js`**: All changes in this file
  - Add setup() method with services
  - Replace 8 alert() calls
  - Implement 3 TODO notifications

### No Changes Needed
- Python models (no backend changes)
- XML views (no UI changes)
- Manifest (services already available in Odoo 19)

## Acceptance Criteria Checklist

- [x] Show "Connecting to terminal..." when payment starts (Line 247)
- [x] Show "Processing payment..." when transaction initiated (Line 252)
- [x] Show amount being charged (included in Step 3)
- [x] Show error popup for declined payments (Line 341)
- [x] Show error popup for connection failures (Line 364)
- [x] Show error popup for API errors (Line 369)
- [x] Remove all `alert()` calls (8 total replacements)
- [x] Use Odoo's `ErrorPopup` and notification system (using AlertDialog + notification service)

## Implementation Notes

1. **Service Injection**: Must use `useService()` in setup() method, not in regular methods
2. **Translation**: All user-facing strings must use `_t()` function
3. **Formatting**: Use `this.env.utils.formatCurrency()` for currency formatting where needed
4. **Dialog vs Notification**:
   - Dialogs (AlertDialog): Blocking errors, configuration issues, critical warnings
   - Notifications: Transient status updates, non-blocking warnings
5. **Existing Pattern**: Follow Odoo 19 POS patterns from PaymentScreen reference

## Risks and Mitigations

| Risk | Mitigation |
|------|------------|
| PaymentScreen already has setup() | Use super.setup() to extend existing setup |
| Services not available in patch | Verify by testing; services should work in patches |
| Notification spam | Use appropriate types; 'connected' happens once, '206' may repeat |
| Breaking existing functionality | Comprehensive regression testing |

## Estimated Complexity
**Low-Medium** - Straightforward replacement of alert() with Odoo services, following established patterns.

## Dependencies
- None (uses built-in Odoo 19 POS services)

## Follow-up Improvements (Future)
- Consider adding loading spinner/overlay during payment processing
- Add timeout handling for long-running transactions
- Show notification on successful payment completion
- Add sound effects for payment events (optional)
