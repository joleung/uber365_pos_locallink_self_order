from odoo import http
from odoo.addons.point_of_sale.controllers.main import PosController
from odoo.tools import file_open


class PosLocalLinkController(PosController):
    """
    Enhanced POS Controller with GoLocalLink SSE Support

    Overrides the ServiceWorker endpoint to serve a custom ServiceWorker
    that excludes GoLocalLink SSE endpoints from caching.

    Issue: ServiceWorkers cannot cache Server-Sent Events (SSE) streaming responses
    Solution: Custom ServiceWorker that skips /api/events/* endpoints

    See: GitHub Issue #22 - ServiceWorker blocks SSE connections
    """

    def _get_pos_service_worker(self):
        """
        Override to serve custom ServiceWorker with GoLocalLink SSE support.

        The custom ServiceWorker extends Odoo's default behavior by:
        1. Skipping cache for /api/events/* (SSE transaction status stream)
        2. Skipping cache for /api/sse/txn/* and /api/txn/* (transaction endpoints)

        This allows SSE connections to work properly without being intercepted
        by the ServiceWorker, while maintaining offline mode for all other POS features.
        """
        try:
            # Try to load our custom ServiceWorker
            with file_open('uber365_pos_locallink/static/src/app/service_worker.js') as f:
                body = f.read()
                return body
        except FileNotFoundError:
            # Fallback to original if our file is not found
            # (shouldn't happen, but safety first)
            return super()._get_pos_service_worker()
