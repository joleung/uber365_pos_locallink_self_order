# POS Self-Order GoLocalLink Payment

GoLocalLink payment terminal integration for Odoo 19 self-ordering kiosks. This module enables customers to pay for food and drinks at self-service kiosk stations using PAX payment terminals via the GoLocalLink payment gateway.

## Features

- 🏪 **Dedicated Kiosk Payment Terminals** - Separate payment terminal configuration for self-ordering kiosks, independent from POS staff terminals
- ⚡ **Real-Time Payment Updates** - Server-Sent Events (SSE) for instant payment status updates without polling
- 🔒 **PCI DSS Compliant** - Secure handling of payment card data with masked logging
- 🎯 **Seamless Customer Experience** - Simple tap-to-pay flow for kiosk customers
- 🔧 **Easy Configuration** - Configure payment terminals per kiosk via Odoo settings
- 🐛 **Debug Mode** - Optional detailed logging for troubleshooting payment issues
- 💳 **Transaction Tracking** - Complete transaction metadata storage (UTI, card BIN, auth codes)

## Requirements

### Odoo Dependencies
- Odoo 19.0+
- `pos_self_order` module (standard Odoo module)
- `uber365_pos_locallink` module (separate GoLocalLink integration for staff POS)
- `point_of_sale` module (standard Odoo module)

### Infrastructure
- PostgreSQL 13+
- GoLocalLink payment gateway server (typically running locally on kiosk)
- PAX payment terminal connected to GoLocalLink server

### Python Dependencies
- `requests` library (typically already available in Odoo)
- `urllib3` library (typically already available in Odoo)

## Installation

### 1. Clone or Download Module

Place this module in your Odoo `devaddons` or `addons` directory:

```bash
cd /path/to/odoo/devaddons
git clone <repository-url> uber365_pos_locallink_self_order
```

### 2. Install Dependencies

Ensure the required modules are available:

```bash
# Install parent uber365_pos_locallink module first
python3 odoo-bin --addons-path="addons,myaddons,devaddons" -d your_database \
  -i uber365_pos_locallink,pos_self_order
```

### 3. Install Module

```bash
python3 odoo-bin --addons-path="addons,myaddons,devaddons" -d your_database \
  -i uber365_pos_locallink_self_order
```

### 4. Restart Odoo

```bash
python3 odoo-bin --addons-path="addons,myaddons,devaddons" -d your_database
```

## Configuration

### 1. Configure POS for Self-Ordering Mode

Navigate to: **Point of Sale → Configuration → Point of Sale**

1. Select your POS configuration
2. Enable **Self-Ordering Mode**
3. Set mode to **Kiosk**

### 2. Configure Kiosk GoLocalLink

In your POS configuration, find the **Kiosk GoLocalLink** section:

| Field | Description | Example |
|-------|-------------|---------|
| **Enable GoLocalLink for Kiosk** | Enable payment terminal integration | ✓ Checked |
| **Kiosk GoLocalLink Server URL** | URL of GoLocalLink gateway server | `http://127.0.0.1:8080` |
| **Kiosk Terminal ID** | PAX terminal identifier | `KIOSK01` |
| **Kiosk PDQ Debug Mode** | Enable detailed logging (⚠️ contains sensitive data) | ☐ Unchecked (production) |

### 3. Configure Payment Methods

Ensure you have at least one payment method configured for your POS:

1. Go to **Point of Sale → Configuration → Payment Methods**
2. Create or configure a payment method
3. Link it to your POS configuration

The module automatically uses the first available non-cash payment method for kiosk transactions.

### 4. GoLocalLink Server Setup

Ensure the GoLocalLink server is running and accessible:

```bash
# Test connectivity
curl http://127.0.0.1:8080/api/health

# Expected: 200 OK or similar successful response
```

## Usage

### Customer Payment Flow

1. **Customer orders items** on the self-ordering kiosk
2. **Navigate to payment page** - Customer clicks "Pay"
3. **Payment initiated** - Kiosk connects to payment terminal
4. **Customer presents card** - Terminal displays "Present card"
5. **Real-time status updates** - UI shows:
   - "Waiting for card..." (initial)
   - "Processing payment..." (card detected)
   - "Payment approved!" (success)
6. **Order completed** - Customer receives confirmation

### Staff Monitoring

Staff can view payment status in real-time:
- WebSocket notifications to POS staff interface
- Payment records stored in `pos.payment` with full transaction metadata
- Transaction details: UTI, card BIN, last 4 digits, auth code

### Cancellation

Customers can cancel payment in-progress:
- Click "Cancel Payment" button during payment
- Terminal cancels transaction
- Returns to payment method selection

### Recovery (SSE Connection Lost)

If network connection drops during payment:
- UI displays "Force Done" button
- Checks transaction status from GoLocalLink server
- Completes payment if approved on terminal
- Prevents duplicate charges

## Architecture

### Payment Flow Diagram

```
┌─────────────┐         ┌──────────────┐         ┌─────────────────┐
│   Kiosk     │         │     Odoo     │         │   GoLocalLink   │
│  Frontend   │         │    Backend   │         │     Server      │
└──────┬──────┘         └──────┬───────┘         └────────┬────────┘
       │                       │                          │
       │  1. Initiate Payment  │                          │
       ├──────────────────────>│                          │
       │   (JSON-RPC)          │  2. Create Transaction   │
       │                       ├─────────────────────────>│
       │                       │   (POST /api/sse/txn)    │
       │                       │                          │
       │   3. Return UTI       │<─────────────────────────┤
       │<──────────────────────┤                          │
       │                       │                          │
       │  4. Connect SSE Stream                           │
       ├──────────────────────────────────────────────────>│
       │   (EventSource /api/events/{uti})                │
       │                       │                          │
       │  5. Status Updates (SSE)                         │
       │<─────────────────────────────────────────────────┤
       │   (connected → processing → approved)            │
       │                       │                          │
       │  6. Complete Payment  │                          │
       ├──────────────────────>│                          │
       │   (JSON-RPC)          │                          │
       │                       │                          │
       │  7. Order Confirmed   │                          │
       │<──────────────────────┤                          │
       │                       │                          │
```

### Key Components

#### Backend (Python)

- **`models/pos_config.py`** - Kiosk-specific configuration fields and validation
- **`models/pos_payment_method.py`** - Payment initiation logic (`_payment_request_from_kiosk`)
- **`models/pos_payment.py`** - Transaction metadata field exports
- **`controllers/main.py`** - HTTP/JSON-RPC endpoints:
  - `/kiosk/golocallink/payment/<config_id>` - Initiate payment
  - `/kiosk/golocallink/events/<uti>` - SSE proxy for status updates
  - `/kiosk/golocallink/complete` - Complete payment
  - `/kiosk/golocallink/cancel` - Cancel payment
  - `/kiosk/golocallink/status/<uti>` - Check transaction status

#### Frontend (JavaScript/OWL)

- **`services/golocallink_payment_service.js`** - Core payment service with SSE connection
- **`pages/payment_page/payment_page.js`** - Payment page patch/override
- **`components/golocallink_payment_status/`** - Payment status UI component

### Technology Stack

- **Backend**: Python 3.10+, Odoo ORM
- **Frontend**: OWL (Odoo Web Library), JavaScript ES6+
- **Communication**: JSON-RPC, Server-Sent Events (SSE)
- **Payment Gateway**: GoLocalLink REST API
- **Database**: PostgreSQL 13+

## Security Considerations

### SSL/TLS

This module **disables SSL certificate verification** (`verify=False`) for GoLocalLink connections:

```python
urllib3.disable_warnings(urllib3.exceptions.InsecureRequestWarning)
response = requests.post(url, ..., verify=False)
```

**Rationale**: GoLocalLink servers often use self-signed certificates when running locally.

**⚠️ Security Note**: This is acceptable for local network communication (payment terminal on same LAN as kiosk). For production deployments:
- Use HTTPS with proper certificates when possible
- Ensure GoLocalLink server is on isolated payment network
- Never expose GoLocalLink server to public internet

### PCI DSS Compliance

- **No card data storage**: Card numbers never stored, only last 4 digits
- **Masked logging**: Sensitive data masked in debug logs
- **Token-based auth**: Access tokens validate all kiosk requests
- **Secure transmission**: Payment data transmitted directly between terminal and GoLocalLink

### Access Control

- All endpoints use `auth='public'` (kiosk customers are not logged in)
- Access validated via order access tokens
- Models use `sudo()` to bypass standard access rights (necessary for public access)

## Development

### Running in Development Mode

```bash
# Start with auto-reload
python3 odoo-bin --addons-path="addons,myaddons,devaddons" -d odoo19 \
  --dev=all -u uber365_pos_locallink_self_order

# Enable debug mode in POS config for detailed logs
```

### Running Tests

```bash
# Run all tests (when implemented)
python3 odoo-bin --addons-path="addons,myaddons,devaddons" -d test_db \
  -i uber365_pos_locallink_self_order --test-enable --stop-after-init

# Run specific test class
python3 odoo-bin --addons-path="addons,myaddons,devaddons" -d test_db \
  --test-tags /uber365_pos_locallink_self_order:TestClassName
```

### Code Quality

```bash
# Lint with ruff
ruff check devaddons/uber365_pos_locallink_self_order

# Format with ruff
ruff format devaddons/uber365_pos_locallink_self_order
```

### Adding Features

Common development tasks:

#### 1. Add Configuration Field

```python
# models/pos_config.py
class PosConfig(models.Model):
    _inherit = 'pos.config'

    new_field = fields.Char(string='New Field')
```

```xml
<!-- views/pos_config_views.xml -->
<field name="kiosk_golocallink_termid" position="after">
    <field name="new_field"/>
</field>
```

#### 2. Modify Payment Logic

Edit `models/pos_payment_method.py::_payment_request_from_kiosk()` or `controllers/main.py` endpoints.

#### 3. Update Frontend UI

Edit `static/src/app/pages/payment_page/payment_page.js` or create new OWL components.

After changes:
```bash
python3 odoo-bin --addons-path="addons,myaddons,devaddons" -d odoo19 \
  -u uber365_pos_locallink_self_order

# Clear browser cache for JS/CSS changes
```

## Troubleshooting

### Payment Not Initiating

**Symptoms**: "Payment initiation failed" error

**Checklist**:
- ✓ GoLocalLink server is running and accessible
- ✓ `kiosk_golocallink_url` is correct
- ✓ `kiosk_golocallink_termid` is configured
- ✓ POS is in "Kiosk" mode (`self_ordering_mode = 'kiosk'`)
- ✓ `kiosk_golocallink_enabled` is checked

**Debug**:
```bash
# Test GoLocalLink connectivity
curl http://127.0.0.1:8080/api/health

# Enable debug mode in POS config
# Check Odoo logs for detailed error messages
```

### SSE Connection Errors

**Symptoms**: "Connection to payment terminal lost"

**Causes**:
- Network interruption between Odoo and GoLocalLink
- GoLocalLink server crashed/restarted
- Timeout (default: 180s)

**Solution**: Use "Force Done" button to check transaction status

### Payment Method Not Found

**Symptoms**: "No valid payment method configured for kiosk"

**Solution**:
1. Go to POS Configuration
2. Add at least one payment method
3. Ensure payment method is not cash and not "pay later" type

### SSL Certificate Errors

**Note**: Should not occur (SSL verification disabled)

If errors persist:
- Check `urllib3.disable_warnings()` is present
- Verify `verify=False` in all requests calls
- Check firewall not intercepting HTTPS traffic

## API Reference

### JSON-RPC Endpoints

#### POST `/kiosk/golocallink/payment/<int:config_id>`

Initiate payment for kiosk order.

**Request**:
```json
{
  "jsonrpc": "2.0",
  "method": "call",
  "params": {
    "config_id": 1,
    "order_data": { /* serialized order */ },
    "access_token": "abc123..."
  }
}
```

**Response**:
```json
{
  "uti": "550e8400-e29b-41d4-a716-446655440000",
  "amount": 10.50,
  "amount_smallest_unit": 1050,
  "currency": "GBP",
  "order_id": 123,
  "access_token": "abc123...",
  "pos_reference": "Order 00001-001-0001"
}
```

#### GET `/kiosk/golocallink/events/<string:uti>`

Server-Sent Events stream for payment status updates.

**Query Params**:
- `config_id` (required): POS configuration ID

**SSE Events**:
```
data: {"status_code": "connected", "uti": "..."}

data: {"status_code": "206", "uti": "..."}

data: {"status_code": "200A", "uti": "...", "bank_id_no": "123456", "card_no_4digit": "1234", "auth_code": "ABC123"}
```

#### POST `/kiosk/golocallink/complete`

Complete payment after terminal approval.

**Request**:
```json
{
  "order_id": 123,
  "access_token": "abc123...",
  "transaction_data": {
    "uti": "550e8400-...",
    "bank_id_no": "123456",
    "card_no_4digit": "1234",
    "auth_code": "ABC123",
    "cardholder_receipt": "..."
  }
}
```

**Response**:
```json
{
  "status": "success",
  "order_id": 123,
  "pos_reference": "Order 00001-001-0001",
  "amount_total": 10.50
}
```

## Contributing

We welcome contributions! Please follow these guidelines:

1. **Fork the repository**
2. **Create a feature branch**: `git checkout -b feature/my-feature`
3. **Follow Odoo conventions**: See parent `CLAUDE.md` for guidelines
4. **Test your changes**: Ensure module installs and payments work
5. **Lint your code**: Run `ruff check` and `ruff format`
6. **Commit your changes**: Use clear, descriptive commit messages
7. **Push to the branch**: `git push origin feature/my-feature`
8. **Create a Pull Request**

### Code Style

- Python: Follow PEP 8 and Odoo conventions
- JavaScript: ES6+, use `const`/`let`, arrow functions
- XML: Inherit views, don't replace

## License

**LGPL-3** (GNU Lesser General Public License v3.0)

This module is free software: you can redistribute it and/or modify it under the terms of the GNU Lesser General Public License as published by the Free Software Foundation, either version 3 of the License, or (at your option) any later version.

See [LICENSE](https://www.gnu.org/licenses/lgpl-3.0.html) for details.

## Support

### Issues & Bug Reports

Please report issues on GitHub: [Create Issue](../../issues/new)

When reporting bugs, include:
- Odoo version (19.0+)
- Module version
- Steps to reproduce
- Error messages/logs (with sensitive data removed)
- Debug mode output (if relevant)

### Contact

- **Author**: Uber365
- **Website**: [https://uber365.com](https://uber365.com)

### Documentation

- [Odoo 19 Documentation](https://www.odoo.com/documentation/19.0/)
- [CLAUDE.md](./CLAUDE.md) - Technical architecture guide for developers
- GoLocalLink API documentation (from your payment terminal provider)

## Changelog

### Version 1.0.0 (Initial Release)

- ✓ GoLocalLink payment terminal integration for kiosks
- ✓ Server-Sent Events (SSE) for real-time status updates
- ✓ Separate kiosk configuration from staff POS terminals
- ✓ PCI DSS compliant data handling
- ✓ Debug mode for troubleshooting
- ✓ Payment cancellation support
- ✓ Force-check status when SSE connection lost

## Acknowledgments

Built on top of:
- **Odoo 19** - Open-source ERP platform
- **GoLocalLink** - Payment gateway for PAX terminals
- **uber365_pos_locallink** - Base GoLocalLink integration module

---

Made with ❤️ by Uber365
