.. image:: https://img.shields.io/badge/licence-LGPL--3-blue.svg
    :target: http://www.gnu.org/licenses/lgpl-3.0-standalone.html
    :alt: License: LGPL-3

====================================
POS GoLocalLink PDQ Integration
====================================

Integrates PAX payment terminals with Odoo Point of Sale using the golocallink payment gateway with real-time Server-Sent Events (SSE) communication.

Features
========

* **Real-time Payment Processing**: Uses Server-Sent Events (SSE) for instant transaction status updates
* **PAX Terminal Integration**: Direct integration with PAX payment terminals via golocallink gateway
* **Currency-Aware Processing**: Automatic amount conversion based on currency decimal places (GBP £10.50 → 1050 pence, JPY ¥100 → 100 yen)
* **Transaction Tracking**: Each transaction tracked with UTI (Universal Transaction Identifier)
* **Comprehensive Metadata Storage**:
    * Transaction ID (UTI)
    * Card BIN (first 6 digits)
    * Card last 4 digits
    * Authorization code
    * Cardholder receipt data
* **Flexible Configuration**:
    * Configurable golocallink server URL per POS (HTTP/HTTPS support)
    * Required Terminal ID field
    * Two access points for configuration (POS config and Settings)
* **Debug Mode**:
    * Optional debug logging for troubleshooting
    * PCI DSS compliant with automatic sensitive data masking
    * Masks card BIN, last 4 digits, and authorization codes in logs
    * Disabled by default with security warning in UI

Technical Architecture
======================

Backend (Python)
----------------

* **pos_config.py**: Extends ``pos.config`` model with golocallink configuration fields:
    * ``use_golocallink``: Enable/disable GoLocalLink PDQ
    * ``golocallink_url``: Server URL (default: http://127.0.0.1:8080)
    * ``golocallink_terminal_id``: Terminal ID (required when enabled)
    * ``pdq_debug_mode``: Debug logging flag (disabled by default)

* **pos_payment.py**: Extends ``pos.payment`` model to store transaction metadata:
    * ``transaction_id``: UTI from golocallink
    * ``pdq_card_bin``: First 6 digits of card (BIN/IIN)
    * ``card_no``: Last 4 digits of card
    * ``payment_method_authcode``: Authorization code
    * ``ticket``: Cardholder receipt data

* **res_config_settings.py**: Adds golocallink settings to global POS configuration interface

Frontend (JavaScript)
---------------------

* **pos_pdq.js**:
    * Patches ``PaymentScreen`` to add "PDQ" payment button
    * Implements SSE client using EventSource API
    * Handles payment transaction flow with real-time status updates
    * Currency-aware amount conversion using ``pos.currency.decimal_places``
    * Conditional debug logging with automatic sensitive data masking

API Integration
---------------

**golocallink API v1.0.0**:

* ``POST /api/sse/txn/sale``: Initiate sale transaction
    * Body: ``{"termid": "1240000000", "amttxn": 1000, "ref": "Order-001"}``
    * Amount in smallest currency unit (pence, cents, yen, etc.)
    * Returns: ``{"uti": "unique-transaction-id", "status": "initiated"}``

* ``GET /api/events/:uti``: SSE stream for transaction events
    * Status codes:
        * ``connected``: Connection established
        * ``206``: Transaction in progress
        * ``200A``: Approved
        * ``200N``: Declined
        * ``000``: Reset/cancelled

Configuration
=============

There are two ways to configure GoLocalLink PDQ settings:

Method 1: Individual POS Configuration
---------------------------------------

1. Navigate to **Point of Sale → Configuration → Point of Sale**
2. Select or create a POS configuration
3. In the **GoLocalLink PDQ Settings** section:
    * Check **GoLocalLink PDQ** to enable
    * Set **GoLocalLink Server URL** (e.g., ``https://127.0.0.1:8443``)
    * Enter **Terminal ID** (required)
    * Optionally enable **PDQ Debug Mode** for troubleshooting (see warning)

Method 2: Global POS Settings (for existing POS)
-------------------------------------------------

1. Navigate to **Settings → Point of Sale → Point of Sale**
2. Configure the same fields as above
3. This updates the currently selected POS configuration

Debug Mode Security
-------------------

When enabling **PDQ Debug Mode**, a warning appears:

    ⚠ **Debug logs may contain sensitive payment data**

Even with debug mode enabled, all sensitive data is automatically masked in logs:

* Card BIN (first 6 digits) → ``******``
* Last 4 digits → ``****``
* Authorization codes → ``[MASKED]``
* Transaction IDs (UTI) remain visible for troubleshooting

Usage
=====

1. **Setup**: Configure GoLocalLink settings as described above
2. **Start POS Session**: Open a POS session on a configured terminal
3. **Add Products**: Add items to cart and click "Payment"
4. **Process Payment**: Click the **"PDQ"** button on the payment screen
5. **Wait for Approval**: The system displays transaction progress in real-time
6. **Complete**: On approval, payment is automatically validated and metadata stored

Payment Flow
------------

1. User clicks "PDQ" button
2. Amount converted to smallest currency unit (e.g., £10.50 → 1050 pence)
3. POST request sent to ``/api/sse/txn/sale`` with transaction details
4. SSE connection established to ``/api/events/:uti`` for status updates
5. Real-time events received: progress, approval, or decline
6. On approval:
    * Transaction metadata stored (UTI, card BIN, last 4 digits, auth code)
    * Payment automatically validated in POS
    * Receipt data saved for printing
7. Transaction complete

Security & Compliance
=====================

PCI DSS Compliance
------------------

* **Debug Mode Disabled by Default**: Reduces exposure of sensitive data
* **Automatic Data Masking**: All debug logs mask card BIN, last 4 digits, and auth codes
* **Protocol Support**: HTTPS recommended for production environments
* **Minimal Data Storage**: Only necessary transaction metadata stored
* **UTI Tracking**: Non-sensitive transaction IDs used for troubleshooting

Data Handling
-------------

* Card BIN (first 6 digits): Stored for transaction analysis
* Last 4 digits: Stored for customer reference
* Full card number: Never transmitted or stored
* Authorization codes: Stored but masked in all logs

Browser Compatibility
=====================

Requires modern browser with EventSource API support:

* Chrome/Edge 6+
* Firefox 6+
* Safari 5+
* Opera 11+

Dependencies
============

* **Odoo Modules**: ``point_of_sale`` (core POS module)
* **External Services**: golocallink server (runs separately)
* **Python**: No external Python dependencies required
* **Hardware**: PAX payment terminal connected to golocallink server

Installation
============

1. Place module in Odoo addons directory (``devaddons/`` or ``myaddons/``)
2. Update module list:
    * Via CLI: ``python3 odoo-bin --addons-path="addons,myaddons,devaddons" -d dbname -u uber365_pos_locallink``
    * Via UI: **Apps → Update Apps List**
3. Install the module:
    * Search for "POS GoLocalLink PDQ Integration"
    * Click **Install**
4. Configure golocallink settings (see Configuration section above)

Development
===========

Frontend Changes
----------------

Changes to JavaScript/XML files require:

* Clear browser cache, OR
* Restart Odoo with ``--dev=all`` flag for auto-reload
* Assets bundled in ``point_of_sale._assets_pos``

Backend Changes
---------------

* Restart Odoo server
* Update module: ``python3 odoo-bin --addons-path="addons,myaddons,devaddons" -d dbname -u uber365_pos_locallink``
* Or via UI: **Apps → POS GoLocalLink PDQ Integration → Upgrade**

Testing
-------

1. **Test Mode**: Enable debug mode in POS configuration
2. **Test Transaction**: Process a small amount payment (e.g., £0.01)
3. **Check Logs**: Review browser console for masked debug output
4. **Verify Storage**: Check payment metadata in **Point of Sale → Orders → Payments**
5. **Disable Debug**: Turn off debug mode for production use

Troubleshooting
===============

Connection Issues
-----------------

* Verify golocallink server is running and accessible
* Check server URL configuration (HTTP vs HTTPS)
* Test server endpoint manually: ``curl http://127.0.0.1:8080/api/health``
* Review browser console for SSE connection errors

Payment Failures
----------------

* Enable debug mode temporarily to see detailed transaction flow
* Verify Terminal ID matches PAX terminal configuration
* Check golocallink server logs for error messages
* Ensure PAX terminal is powered on and connected

Amount Conversion Issues
------------------------

* Verify currency decimal places: **Accounting → Configuration → Currencies**
* GBP/USD/EUR should have 2 decimal places (£10.50 → 1050)
* JPY should have 0 decimal places (¥100 → 100)
* Check browser console for amount calculation (when debug enabled)

Known Limitations
=================

* **Single Payment Method**: Designed for card payments only (no split payments)
* **SSE Protocol**: Requires Server-Sent Events (not WebSocket compatible)
* **Terminal Availability**: One transaction at a time per terminal
* **Network Dependency**: Requires stable connection to golocallink server
* **Browser Support**: EventSource API required (IE11 not supported)

Roadmap
=======

Potential future enhancements:

* Multi-terminal support within single POS
* Refund transaction support via golocallink
* Transaction history and reporting
* Contactless payment amount limits
* Receipt template customization
* Offline mode with transaction queuing

Company
=======

* **Uber365** - https://www.w00.uk

Maintainer
==========

This module is maintained by Uber365.

For support and more information, please visit our website.

Credits
=======

:Author: Uber365
:Version: 2.0.0
:License: LGPL-3
:Category: Point of Sale

Bug Tracker
===========

Bugs and feature requests should be reported through the project's issue tracking system or by contacting Uber365 support.

Changelog
=========

Version 2.0.0
-------------

* Complete rewrite for Odoo 19 compatibility
* Added comprehensive GoLocalLink PDQ integration
* Implemented SSE-based real-time payment processing
* Added PCI DSS compliant debug mode with data masking
* Added currency-aware amount conversion
* Added comprehensive transaction metadata storage
* Added dual configuration interface (POS config and Settings)
* Added Terminal ID validation
* Added security warnings for debug mode
* Updated documentation with architecture details
