# -*- coding: utf-8 -*-
{
    'name': 'POS GoLocalLink PDQ Integration',
    'version': '2.0.0',
    'category': 'Point of Sale',
    'summary': "PAX payment terminal integration via golocallink gateway using Server-Sent Events",
    'description': """
POS GoLocalLink PDQ Integration
================================

Integrates PAX payment terminals with Odoo Point of Sale using the golocallink payment gateway.

Features:
---------
* Real-time payment processing using Server-Sent Events (SSE)
* PAX terminal integration for card payments
* Transaction tracking with UTI (Universal Transaction Identifier)
* Automatic storage of card details and authorization codes
* Configurable golocallink server URL per POS configuration

Technical Details:
------------------
* Uses golocallink API v1.0.0 (SSE-based)
* Endpoints: POST /api/sse/txn/sale, GET /api/events/:uti
* Stores transaction data: UTI, card BIN, last 4 digits, auth code

Configuration:
--------------
1. Go to Point of Sale > Configuration > Point of Sale
2. Enable "GoLocalLink PDQ" and set the server URL
3. Default: http://127.0.0.1:8080
    """,
    'author': 'Uber365',
    'company': 'Uber365',
    'maintainer': 'Uber365',
    'website': 'https://www.w00.uk',
    'depends': ['point_of_sale'],
    'data': [
        'views/pos_config_views.xml',
        'views/res_config_settings_views.xml',
        'views/pos_payment_views.xml',
    ],
    'assets': {
        'point_of_sale._assets_pos': [
            'uber365_pos_locallink/static/src/js/*.js',
            'uber365_pos_locallink/static/src/xml/*.xml',
            'uber365_pos_locallink/static/src/scss/*.scss',
        ],
    },
    'images': ['static/description/banner.png'],
    'license': 'LGPL-3',
    'installable': True,
    'auto_install': False,
    'application': False
}
