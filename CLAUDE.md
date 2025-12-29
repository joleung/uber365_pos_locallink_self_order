# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Overview

This is an Odoo 19 module (`uber365_pos_locallink`) that integrates PAX payment terminals with the Point of Sale system via the golocallink payment gateway using Server-Sent Events (SSE). The module enables real-time card payment processing directly from the POS interface.

**Module Name:** `uber365_pos_locallink`
**Module Path:** `/devaddons/uber365_pos_locallink` (within larger Odoo 19 repository)

**📖 API Documentation:** For complete GoLocalLink RESTful API documentation, see [GOLOCALLINK.md](GOLOCALLINK.md)

## Architecture

### Module Structure

- **Python Backend**:
  - `models/pos_config.py`: Extends `pos.config` to add golocallink configuration (enable flag, server URL, terminal ID, debug mode)
  - `models/pos_payment.py`: Extends `pos.payment` to store transaction metadata (UTI, card BIN, last 4 digits, auth code)
  - `models/res_config_settings.py`: Adds golocallink settings to POS configuration screen
  - `controllers/main.py`: Overrides `PosController._get_pos_service_worker()` to serve custom ServiceWorker (Issue #22 fix)

- **JavaScript Frontend**:
  - `static/src/js/pos_pdq.js`: Main payment integration
    - Patches the `PaymentScreen` component to add "PDQ" payment button
    - Implements SSE client for real-time communication with golocallink server
    - Handles payment transaction flow and status updates via EventSource API
    - Implements conditional debug logging with sensitive data masking for PCI DSS compliance
  - `static/src/js/pdq_payment_status.js`: Payment status component
    - **Payment status display** with reactive state management (using OWL useState)
    - **Cancel payment** functionality - closes SSE connection and resets status
    - **Force Done** functionality - retrieves transaction status from GoLocalLink API
  - `static/src/app/service_worker.js`: Custom ServiceWorker (Issue #22 fix)
    - Extends Odoo's default POS ServiceWorker
    - Excludes `/api/events/*` (SSE endpoints) from caching
    - Excludes `/api/sse/txn/*` and `/api/txn/*` (transaction endpoints) from caching
    - Allows SSE connections to work without ServiceWorker interference

- **Frontend UI Components**:
  - `static/src/xml/pos_pdq.xml`: PDQ payment button template
  - `static/src/xml/payment_line_status.xml`: Payment status display template (inherits from PaymentScreen)
  - `static/src/scss/payment_status.scss`: Styling for payment status display (matches Odoo POS patterns)

- **XML Views**:
  - `views/pos_config_views.xml`: Adds golocallink fields to POS configuration form
  - `views/res_config_settings_views.xml`: Adds golocallink settings panel
  - `views/pos_payment_views.xml`: Adds transaction fields to payment tree view

### Key Integration Points

1. **Server-Sent Events (SSE) Communication**:
   - Frontend connects to golocallink server (configurable per POS, default: `http://127.0.0.1:8080`)
   - API endpoint: `POST /api/sse/txn/sale` to initiate transaction
   - Event stream: `GET /api/events/:uti` for real-time status updates
   - UTI (Universal Transaction Identifier) tracks each transaction
   - **ServiceWorker Override**: Custom ServiceWorker excludes SSE endpoints from caching (see [controllers/main.py](controllers/main.py:6))
     - Fixes Issue #22: ServiceWorker was blocking SSE connections
     - Overrides `PosController._get_pos_service_worker()` to serve [static/src/app/service_worker.js](static/src/app/service_worker.js)

2. **Payment Flow**:
   - User clicks "PDQ" button on payment screen
   - Currency-aware amount conversion (e.g., GBP pounds → pence, JPY yen → yen)
   - POST request to `/api/sse/txn/sale` with amount in smallest currency unit
   - **Payment status display appears** showing "Initiating payment..."
   - SSE connection established to `/api/events/:uti`
   - **Status updates in real-time:**
     - "Waiting for card on terminal..." (with Cancel + Force Done buttons)
     - "Processing payment of £XX.XX..." (with Force Done button)
     - "Payment Successful" (with checkmark icon)
   - Transaction events received: progress updates, approval, or decline
   - On approval, payment metadata stored: UTI, card BIN (first 6 digits), last 4 digits, auth code
   - Payment automatically validated in POS

3. **Configuration**:
   - Navigate to: Point of Sale > Configuration > Point of Sale (or Settings > Point of Sale > Point of Sale)
   - Enable "GoLocalLink PDQ" checkbox
   - Set "GoLocalLink Server URL" (e.g., `https://127.0.0.1:8443`)
   - Set "Terminal ID" (required when enabled)
   - Optionally enable "PDQ Debug Mode" for troubleshooting (disabled by default)
   - Configuration stored in `pos.config` model

### Data Storage

Payment metadata fields in `pos.payment`:
- `transaction_id`: UTI from golocallink
- `card_no`: Last 4 digits of card
- `pdq_card_bin`: First 6 digits of card (BIN/IIN) - custom field
- `payment_method_authcode`: Authorization code from payment processor
- `ticket`: Cardholder receipt data

### Payment Status Display (Issue #23)

**New UI Feature** - Real-time payment status display on payment screen:

**Status States:**
- **`waiting`**: "Initiating payment..." (spinner icon, no buttons)
- **`waitingCard`**: "Waiting for card on terminal..." (spinner icon, Cancel + Force Done buttons)
- **`processing`**: "Processing payment of £XX.XX..." (spinner icon, Force Done button)
- **`done`**: "Payment Successful" (checkmark icon, brief display before clearing)

**User Actions:**

1. **Cancel Button** (available during `waitingCard` state):
   - Closes SSE connection to GoLocalLink server
   - Resets payment status
   - Removes payment line if created
   - Shows warning notification
   - **Note:** Terminal may still process payment if card was already read

2. **Force Done Button** (available during `waitingCard` and `processing` states):
   - Retrieves transaction status from GoLocalLink API (`GET /api/txn/:uti`)
   - Use case: Network connection lost but terminal may have processed payment
   - Handles three scenarios:
     - **Approved**: Stores transaction data and completes order
     - **Declined/Cancelled**: Shows error dialog
     - **In Progress** (status `206`): Shows dialog to wait or check terminal
   - Displays transaction ID (UTI) for manual verification

**Visual Design:**
- Gray background (`#f0f0f0`) matching Odoo POS payment integration patterns
- Blue spinning icon (`#0d6efd`) for processing states
- Green checkmark (`#198754`) for success
- Fade-in animation (300ms)
- Responsive layout for mobile/tablet devices
- Follows Adyen/Stripe payment integration patterns

**Implementation Details:**
- Uses OWL `useState` for reactive status tracking
- Status stored in `pdqPaymentStatus` object with properties:
  - `active`: Boolean - whether status display is shown
  - `status`: String - current status state
  - `uti`: String - transaction ID
  - `amount`: Number - payment amount
  - `eventSource`: EventSource - SSE connection reference for cancellation
- Template inheritance: `point_of_sale.PaymentScreen`
- Files: [static/src/xml/payment_line_status.xml](static/src/xml/payment_line_status.xml), [static/src/scss/payment_status.scss](static/src/scss/payment_status.scss)

### Security & Compliance

**PCI DSS Compliance**:
- Debug logging disabled by default (`pdq_debug_mode=False`)
- All debug logs mask sensitive payment data even when enabled:
  - Card BIN (first 6 digits) → `******`
  - Last 4 digits → `****`
  - Authorization codes → `[MASKED]`
- UTI/transaction ID remains visible (needed for troubleshooting, not PCI sensitive)

**Debug Mode** (`pos.config.pdq_debug_mode`):
- Controlled via UI with security warning
- When enabled, logs payment flow for troubleshooting
- Helper functions:
  - `_pdqDebug(message, data)`: Conditional logging with automatic data masking
  - `_maskSensitiveData(data)`: Masks card BIN, last 4 digits, and auth codes

## Development

### Module Installation

Standard Odoo module installation (run from Odoo root directory):

```bash
# Install module (first time)
python3 odoo-bin --addons-path="addons,myaddons,devaddons" -d odoo19 -i uber365_pos_locallink

# Update module (after changes)
python3 odoo-bin --addons-path="addons,myaddons,devaddons" -d odoo19 -u uber365_pos_locallink

# Or via UI:
# Apps > Update Apps List > Search "POS GoLocalLink PDQ Integration" > Install
```

**Note**: Always include `--addons-path="addons,myaddons,devaddons"` to ensure custom modules in devaddons/ are found.

### Testing Changes

**Frontend Changes** (JavaScript/XML/SCSS):
- Changes to `static/src/js/*.js`, `static/src/xml/*.xml`, or `static/src/scss/*.scss` require:
  - Clear browser cache (hard refresh: Cmd+Shift+R / Ctrl+Shift+R), OR
  - Restart Odoo with `--dev=all` flag for auto-reload
- Assets bundled in `point_of_sale._assets_pos`
- **Important**: ServiceWorker changes (`static/src/app/service_worker.js`) require:
  1. Update module to reload controller
  2. Unregister old ServiceWorker in browser DevTools > Application > Service Workers
  3. Hard refresh browser

**Backend Changes** (Python/Views/XML):
```bash
# From Odoo root directory
python3 odoo-bin --addons-path="addons,myaddons,devaddons" -d odoo19 -u uber365_pos_locallink

# Or with development mode (auto-reload Python on file changes)
python3 odoo-bin --addons-path="addons,myaddons,devaddons" -d odoo19 -u uber365_pos_locallink --dev=all
```

**Via UI**: Apps > POS GoLocalLink PDQ Integration > Upgrade

### View File Relationship: pos_config_views.xml vs res_config_settings_views.xml

**IMPORTANT**: When adding or modifying GoLocalLink configuration fields, you typically need to update BOTH view files:

1. **`views/pos_config_views.xml`**:
   - Used for creating **new** POS configurations
   - Extends individual POS configuration forms
   - Access: Point of Sale → Configuration → Point of Sale → [Select/Create POS]
   - Inherits from: `point_of_sale.pos_config_view_form`

2. **`views/res_config_settings_views.xml`**:
   - Used for **updating existing** GoLocalLink configuration
   - Provides global POS settings interface
   - Access: Settings → Point of Sale → Point of Sale
   - Inherits from: `point_of_sale.res_config_settings_view_form`
   - Fields use `related='pos_config_id.field_name'` with `readonly=False`

**Pattern**: When adding a new field to `pos.config`:
1. Add the field definition to `models/pos_config.py`
2. Add the field to `views/pos_config_views.xml` (for new POS setup)
3. Add a related field to `models/res_config_settings.py`
4. Add the field to `views/res_config_settings_views.xml` (for updating existing config)

**Layout Convention**:
- Both view files use 4:8 column ratio (`col-lg-4` for labels, `col-lg-8` for fields)
- Always wrap fields in column divs for proper Bootstrap grid layout
- Example:
  ```xml
  <div class="row">
      <label string="Field Name" for="field_name" class="col-lg-4 o_light_label"/>
      <div class="col-lg-8">
          <field name="field_name"/>
      </div>
  </div>
  ```

This ensures users can configure the field in both contexts with consistent layout.

### GoLocalLink Server Configuration

The golocallink server URL is configurable per POS:
- UI: Point of Sale > Configuration > Point of Sale > GoLocalLink Settings
- Model field: `pos.config.golocallink_url`
- Default: `http://127.0.0.1:8080`
- Supports both HTTP and HTTPS protocols

### GoLocalLink RESTful API

**📖 For complete API documentation, refer to [GOLOCALLINK.md](GOLOCALLINK.md)**

The GOLOCALLINK.md file contains comprehensive API documentation including:
- All available endpoints and their parameters
- Complete request/response examples
- Transaction status codes and error codes
- Transaction processing timeline and timing details
- Security considerations (encryption, PCI DSS compliance)
- Error handling patterns (circuit breaker, retry logic, health checks)
- Receipt format specifications
- Complete transaction flow examples

**Quick Reference - Key Endpoints Used by This Module:**

#### 1. `POST /api/sse/txn/sale` - Initiate Sale Transaction

**Request:**
```json
{
  "termid": "",
  "amttxn": 1000,
  "ref": "Order-001"
}
```

**Important Request Notes:**
- `termid`: Terminal ID field (currently unused by API, reserved for future use)
- `amttxn`: Amount in **cents/pence** (1000 = $10.00 or £10.00)
- `ref`: Reference identifier (reserved for future use)

**Response (201 Created):**
```json
{
  "uti": "550e8400-e29b-41d4-a716-446655440000",
  "amountTrans": 10.00,
  "transType": "SALE",
  "amountCashback": 0.0,
  "amountGratuity": 0.0
}
```

**Critical Note:** The response does NOT include a `status` field. Transaction status updates come exclusively from the SSE event stream.

**Error Responses:**
- `503` - Terminal health check failed or circuit breaker open
- `400` - Invalid request body format

#### 2. `GET /api/events/:uti` - SSE Stream for Transaction Status

Establishes a Server-Sent Events connection for real-time transaction updates.

**SSE Status Codes:**

| Status Code | Meaning | Data Included | Final State |
|-------------|---------|---------------|-------------|
| `connected` | SSE connection established | `uti` | No |
| `206` | Transaction in progress (waiting for card) | `uti` | No |
| `200A` | Transaction **approved** | `uti`, `bank_id_no`, `card_no_4digit`, `auth_code`, receipts | Yes |
| `200N` | Transaction **declined/canceled** | `uti` | Yes |
| `500` | Transaction **error** | `uti`, `error_code`, `error_message` | Yes |
| `000` | Reset status (connection will close) | `uti` | Yes |

**Approved Transaction Data (`200A`):**
- `bank_id_no`: First 6 digits of card (BIN - Bank Identification Number)
- `card_no_4digit`: Last 4 digits of card
- `auth_code`: Authorization code from card issuer
- `cardholder_receipt`: Plain text receipt for cardholder
- `merchant_receipt`: Plain text receipt for merchant

**Transaction Timing (Important for UX):**
- **Initial wait**: 10 seconds before first status poll
- **Polling interval**: 5 seconds between status updates
- **Maximum duration**: 2 minutes (120 seconds) before timeout
- **Reset delay**: 8 seconds after completion before sending `000` status
- **Connection closure**: 1 second after `000` status sent

This means users may wait 10+ seconds before seeing "Processing payment..." notification.

**Error Handling Features:**
- **Circuit breaker**: Opens after 5 consecutive terminal failures, remains open for 30 seconds
- **Health checks**: Performed before every transaction, cached for 30 seconds
- **Automatic retry**: Up to 3 attempts with exponential backoff (1s, 2s, 4s)
- **Polling tolerance**: Tolerates up to 5 consecutive polling errors before failing

See [GOLOCALLINK.md](GOLOCALLINK.md) sections on "Error Codes", "Transaction Processing Timeline", and "Error Handling" for complete details.

## Important Notes

- **Module Name**: `uber365_pos_locallink` (not `odoie_pos_button` - that was the old name)
- **Parent Repository**: This module lives in `/devaddons/uber365_pos_locallink` of a larger Odoo 19 installation
  - See `/CLAUDE.md` (Odoo root) for general Odoo development guidance
  - Always run commands from Odoo root with `--addons-path="addons,myaddons,devaddons"`
- **Amount Conversion**: Currency-aware conversion using `pos.currency.decimal_places`
  - GBP/USD/EUR (2 decimals): £10.50 → 1050 pence (multiply by 10²)
  - JPY (0 decimals): ¥100 → 100 yen (multiply by 10⁰)
  - Currencies with 3 decimals: multiply by 10³
- **Terminal ID**: Required field when GoLocalLink is enabled (validated by constraint in [models/pos_config.py](models/pos_config.py))
- **Transaction Tracking**: Each transaction identified by UTI (Universal Transaction Identifier)
- **SSE vs WebSocket**: Module uses Server-Sent Events (EventSource API), not WebSockets
- **ServiceWorker Caveat**: Custom ServiceWorker override required for SSE to work with Odoo's offline mode (see Issue #22)
- **Module Dependencies**: Only requires `point_of_sale` module (no external Python dependencies)
- **Browser Compatibility**: Requires browser support for EventSource API (all modern browsers)
- **Security**:
  - HTTP/HTTPS protocol support; configure HTTPS for production environments
  - PCI DSS compliant with debug mode and data masking
  - Sensitive payment data (card BIN, last 4 digits, auth codes) always masked in logs
  - GoLocalLink server uses AES-GCM encryption for stored transaction data
  - See [GOLOCALLINK.md](GOLOCALLINK.md) "Security Considerations" section for complete details

## Additional Documentation

- [GOLOCALLINK.md](GOLOCALLINK.md) - Complete GoLocalLink RESTful API documentation
- [README.rst](README.rst) - User-facing module documentation
- [SPEC.md](SPEC.md) - Technical specifications (if present)
- [IMPLEMENTATION_PLAN.md](IMPLEMENTATION_PLAN.md) - Development planning (if present)
- [PAYMENT_STATUS_REPORT.md](PAYMENT_STATUS_REPORT.md) - Payment status feature documentation (if present)

**For additional technical details including:**
- Complete error code reference
- Circuit breaker and retry logic details
- Transaction timing and polling behavior
- Receipt format specifications
- Database encryption details
- Testing and monitoring guidance

**Please refer to [GOLOCALLINK.md](GOLOCALLINK.md)**
