# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Overview

**uber365_pos_locallink_self_order** is an Odoo 19.0 module that integrates GoLocalLink payment terminals with self-ordering kiosks. It enables customers to pay for food and drinks at kiosk stations using PAX payment terminals via the GoLocalLink payment gateway.

**Parent Framework**: Odoo 19.0 ERP/business application suite
**Module Type**: Custom addon (located in `/devaddons/`)
**Dependencies**: `pos_self_order`, `uber365_pos_locallink`, `point_of_sale`

## Module Architecture

This module follows Odoo's standard structure with Python backend (models/controllers) and OWL JavaScript frontend:

```
uber365_pos_locallink_self_order/
├── __manifest__.py              # Module metadata and dependencies
├── __init__.py                  # Python package initialization
├── models/                      # Backend ORM models
│   ├── pos_config.py           # Kiosk GoLocalLink configuration fields
│   ├── pos_payment.py          # Payment record fields for transaction metadata
│   ├── pos_payment_method.py   # Payment initiation logic (_payment_request_from_kiosk)
│   └── res_config_settings.py  # Settings page integration
├── controllers/
│   └── main.py                 # HTTP/JSON-RPC controllers for payment flow
├── views/                      # Backend UI (XML view definitions)
│   ├── pos_config_views.xml
│   ├── pos_payment_views.xml
│   └── res_config_settings_views.xml
├── security/
│   └── ir.model.access.csv     # Access control (currently empty - inherits only)
└── static/src/app/             # Frontend (OWL components and services)
    ├── components/
    │   └── golocallink_payment_status/  # Payment status UI component
    ├── pages/
    │   └── payment_page/               # Payment page patch/override
    └── services/
        ├── golocallink_payment_service.js  # Core payment service (SSE, RPC)
        ├── self_order_service_patch.js     # Self-order service extensions
        └── data_service_patch.js           # Data loading patches
```

## Payment Flow Architecture

### High-Level Flow

1. **Initiate Payment** (Frontend → Backend)
   - User clicks "Pay" on kiosk
   - Frontend calls `/kiosk/golocallink/payment/{config_id}` (JSON-RPC)
   - Backend creates/updates order, calls `_payment_request_from_kiosk()`
   - Backend sends POST to GoLocalLink server to create transaction
   - Returns UTI (Universal Transaction Identifier)

2. **Real-Time Status Updates** (Frontend ↔ GoLocalLink via SSE)
   - Frontend connects to `/kiosk/golocallink/events/{uti}` (Server-Sent Events)
   - Odoo backend acts as SSE proxy to GoLocalLink server
   - Streams payment status updates: `connected` → `206` (processing) → `200A` (approved) / `200N` (declined)

3. **Complete Payment** (Frontend → Backend)
   - On approval, frontend calls `/kiosk/golocallink/complete` (JSON-RPC)
   - Backend creates `pos.payment` record with transaction metadata
   - Marks order as paid via `action_pos_order_paid()`
   - Sends WebSocket notification to POS staff interface

### Key Endpoints (controllers/main.py)

- **`/kiosk/golocallink/payment/<config_id>`** (JSON-RPC, auth='public')
  - Initiates payment, returns UTI
  - Validates access token, creates order via `process_order()`

- **`/kiosk/golocallink/events/<uti>`** (HTTP SSE, auth='public')
  - Proxies SSE stream from GoLocalLink server to frontend
  - Streams real-time payment status updates

- **`/kiosk/golocallink/complete`** (JSON-RPC, auth='public')
  - Completes payment after terminal approval
  - Creates `pos.payment` record with transaction data

- **`/kiosk/golocallink/cancel`** (JSON-RPC, auth='public')
  - Cancels in-progress payment

- **`/kiosk/golocallink/status/<uti>`** (JSON-RPC, auth='public')
  - Retrieves transaction status (used when SSE connection lost)

### Frontend Service (golocallink_payment_service.js)

Reactive service providing:
- `initiatePayment(order, amount)` - Starts payment flow
- `connectSSE(uti, onStatusUpdate, onComplete, onError)` - Connects SSE stream
- `cancelPayment()` - Cancels payment
- `getTransactionStatus()` - Force-check status (fallback when SSE fails)
- `completePayment(orderId, accessToken, transactionData)` - Finalizes payment on backend
- `paymentStatus` - Reactive state object (status, uti, amount, eventSource)

## Development Commands

### Running the Module

```bash
# IMPORTANT: This module is part of a larger Odoo instance.
# Always include the full addons path when running odoo-bin commands:

# Start Odoo server with this module
python3 odoo-bin --addons-path="addons,myaddons,devaddons" -d odoo19

# Install this module
python3 odoo-bin --addons-path="addons,myaddons,devaddons" -d odoo19 -i uber365_pos_locallink_self_order

# Update this module after changes
python3 odoo-bin --addons-path="addons,myaddons,devaddons" -d odoo19 -u uber365_pos_locallink_self_order

# Development mode with auto-reload
python3 odoo-bin --addons-path="addons,myaddons,devaddons" -d odoo19 --dev=all

# Quick start using script (already includes correct addons path)
cd /Users/kaitai/dev/odoo/19/odoo && ./start.sh
```

**Note**: The parent Odoo instance uses custom addon paths. The `--addons-path="addons,myaddons,devaddons"` flag ensures custom modules in `/devaddons/` are loaded.

### Testing

```bash
# Run tests for this module
python3 odoo-bin --addons-path="addons,myaddons,devaddons" -d test_db \
  -i uber365_pos_locallink_self_order --test-enable --stop-after-init

# Run specific test class
python3 odoo-bin --addons-path="addons,myaddons,devaddons" -d test_db \
  --test-tags /uber365_pos_locallink_self_order:ClassName

# Currently no tests exist - would be placed in tests/ directory
```

### Code Quality

```bash
# Lint with ruff (follows parent Odoo's ruff.toml)
cd /Users/kaitai/dev/odoo/19/odoo
ruff check devaddons/uber365_pos_locallink_self_order

# Format with ruff
ruff format devaddons/uber365_pos_locallink_self_order
```

## Key Technical Details

### Security & SSL

- **SSL Verification Disabled**: GoLocalLink often uses self-signed certificates
  - `urllib3.disable_warnings()` suppresses SSL warnings
  - `verify=False` in all `requests.get/post()` calls
  - **Only acceptable for local network communication** (payment terminal on same network)

- **Public Authentication**: All endpoints use `auth='public'`
  - Access controlled via order access tokens (validated in `_verify_authorization()`)
  - Payment methods use `sudo()` to bypass standard access rights for kiosk users

### PCI DSS Compliance

- **Sensitive Data Handling**:
  - Transaction data (card BIN, last 4 digits, auth codes) handled according to PCI DSS
  - `maskSensitiveData()` function in frontend service masks data in debug logs
  - Debug mode (`kiosk_pdq_debug_mode`) includes warning: "may contain sensitive payment data"

### Configuration Fields (models/pos_config.py)

- `kiosk_golocallink_enabled` - Enable GoLocalLink for this kiosk
- `kiosk_golocallink_url` - GoLocalLink server URL (default: `http://127.0.0.1:8080`)
- `kiosk_golocallink_termid` - PAX terminal identifier
- `kiosk_pdq_debug_mode` - Enable detailed logging (WARNING: logs sensitive data)

**Validation** (`_check_kiosk_golocallink_config`):
- Only enables when `self_ordering_mode == 'kiosk'`
- Requires URL and Terminal ID when enabled
- Validates URL protocol (http:// or https://)
- Warns if using HTTP on non-localhost

### Currency Handling

Amount conversion to smallest unit (e.g., £10.50 → 1050 pence):
```python
decimal_places = currency.decimal_places or 2
multiplier = 10 ** decimal_places
amount_smallest_unit = int(round(order.amount_total * multiplier))
```

### OWL Frontend Patterns

- **Service Registration**: `registry.category("services").add("golocallink_payment", ...)`
- **Component Patching**: Uses `patch(PaymentPage.prototype, {...})` to extend base component
- **Reactive State**: `reactive({...})` for payment status tracking
- **Service Dependencies**: `dependencies: ["self_order", "notification"]`

### Data Loading (_load_pos_self_data)

- `pos.payment.method` uses `sudo()` in `_load_pos_self_data_search_read()` for public access
- `_load_pos_self_data_domain()` modified to load all payment methods when GoLocalLink enabled
- `pos.payment` exports GoLocalLink fields via `_load_pos_self_data_fields()`

## Common Development Tasks

### Modifying Payment Flow

1. Backend logic: Edit `models/pos_payment_method.py::_payment_request_from_kiosk()`
2. HTTP endpoints: Edit `controllers/main.py`
3. Frontend service: Edit `static/src/app/services/golocallink_payment_service.js`
4. UI components: Edit `static/src/app/pages/payment_page/payment_page.js` or `components/golocallink_payment_status/`

After changes:
```bash
python3 odoo-bin --addons-path="addons,myaddons,devaddons" -d odoo19 -u uber365_pos_locallink_self_order
# Clear browser cache for JS/CSS changes
```

### Adding New Configuration Fields

1. Add field to `models/pos_config.py`
2. Add to view in `views/pos_config_views.xml`
3. Update constraints in `_check_kiosk_golocallink_config()` if needed
4. Update module:
   ```bash
   python3 odoo-bin --addons-path="addons,myaddons,devaddons" -d odoo19 -u uber365_pos_locallink_self_order
   ```

### Debugging Payment Issues

1. **Enable debug mode**: Set `kiosk_pdq_debug_mode = True` in POS Config
2. **Check backend logs**:
   - Watch Odoo server console output
   - Look for `[GoLocalLink Kiosk]` prefixed messages
3. **Check frontend console**:
   - Browser DevTools → Console
   - Look for `[GoLocalLink Kiosk]` prefixed messages
4. **Verify GoLocalLink server**:
   - Check `{kiosk_golocallink_url}/api/health` or similar endpoint
   - Ensure terminal is powered on and connected

**Common Issues**:
- **Connection timeout**: GoLocalLink server not running or unreachable
- **SSL errors**: Self-signed certificate issues (should be suppressed by `verify=False`)
- **Payment method not found**: Check `payment_method_ids` on POS Config
- **SSE connection lost**: Network interruption - use "Force Done" button to check status

## Asset Management

Assets loaded via `__manifest__.py`:
```python
'assets': {
    'pos_self_order.assets': [
        'uber365_pos_locallink_self_order/static/src/app/**/*.js',
        'uber365_pos_locallink_self_order/static/src/app/**/*.xml',
        'uber365_pos_locallink_self_order/static/src/scss/**/*.scss',
    ],
}
```

**Important**: Asset paths use module directory name, NOT absolute paths starting with `/`.

## Integration Points

### Depends On
- **pos_self_order**: Base self-ordering kiosk functionality
- **uber365_pos_locallink**: GoLocalLink integration for POS staff terminals (separate config)
- **point_of_sale**: Core POS functionality

### Extends
- `pos.config` - Adds kiosk-specific GoLocalLink fields
- `pos.payment.method` - Adds `_payment_request_from_kiosk()` method
- `pos.payment` - Exports GoLocalLink transaction fields
- `res.config.settings` - Adds settings page fields
- `PaymentPage` (OWL) - Patches payment flow for GoLocalLink

### Separation from Staff POS
This module is **separate** from `uber365_pos_locallink` (staff POS integration):
- Different configuration fields (`kiosk_*` vs standard fields)
- Different payment terminals (kiosk terminal vs staff terminal)
- Different workflows (customer self-service vs cashier-operated)

## Important Conventions

### Python
- Follow Odoo conventions (see parent `/CLAUDE.md`)
- Use `_logger.info/warning/error()` for logging
- Always use `sudo()` when accessing models from public endpoints

### JavaScript
- Use ES6+ syntax (arrow functions, const/let, destructuring)
- Prefix debug logs with `[GoLocalLink Kiosk]`
- Use reactive state for UI updates
- Import from `@odoo/owl`, `@web/core/*`, `@pos_self_order/*`

### XML
- Inherit existing views, don't replace
- Use `position="after/before/inside/replace/attributes"`
- Prefix XML IDs with module name to avoid conflicts

## Useful References

- Odoo 19 Documentation: https://www.odoo.com/documentation/19.0/
- Parent Odoo instance: `/Users/kaitai/dev/odoo/19/odoo/CLAUDE.md`
- GoLocalLink API: Typically documented by payment terminal provider
