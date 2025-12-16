# -*- coding: utf-8 -*-
{
    'name': 'POS Self-Order GoLocalLink Payment',
    'version': '1.0.0',
    'category': 'Point of Sale',
    'summary': 'GoLocalLink payment terminal integration for self-ordering kiosks',
    'description': """
        This module enables customers to pay for self-ordered food and drinks
        using a GoLocalLink payment terminal attached to the kiosk.

        Features:
        - Real-time payment status via Server-Sent Events (SSE)
        - Dedicated payment terminal for each kiosk
        - Separate configuration from POS staff terminals
        - PCI DSS compliant data handling
        - Debug mode for troubleshooting
    """,
    'author': 'Uber365',
    'website': 'https://uber365.com',
    'depends': [
        'pos_self_order',
        'uber365_pos_locallink',
        'point_of_sale',
    ],
    'data': [
        'security/ir.model.access.csv',
        'views/pos_config_views.xml',
        'views/res_config_settings_views.xml',
        'views/pos_payment_views.xml',
    ],
    'assets': {
        'pos_self_order.assets': [
            'uber365_pos_locallink_self_order/static/src/app/**/*.js',
            'uber365_pos_locallink_self_order/static/src/app/**/*.xml',
            'uber365_pos_locallink_self_order/static/src/scss/**/*.scss',
        ],
    },
    'installable': True,
    'auto_install': False,
    'license': 'LGPL-3',
}
