"""Validate the permitted Shopify grant before deployment; no account/API calls."""
from pathlib import Path
from tempfile import TemporaryDirectory
import unittest
from validate_shopify_config import ROOT, validate


class ShopifyConfigurationTests(unittest.TestCase):
    def test_template_and_fail_closed_variants(self):
        source = (ROOT / "shopify.app.toml.example").read_text(encoding="utf-8")
        self.assertEqual(validate(ROOT / "shopify.app.development.toml.example", True), [])
        self.assertTrue(validate(ROOT / "shopify.app.development.toml.example", False))
        with TemporaryDirectory(prefix="drapixai-shopify-config-") as directory:
            config = Path(directory) / "shopify.app.toml"
            config.write_text(source, encoding="utf-8")
            self.assertEqual(validate(config, True), [])
            self.assertTrue(validate(config, False), "A template cannot be deployed as real credentials")
            cases = [
                ("standalone entry", source.replace('embedded = true', 'embedded = false')),
                ("OAuth entry instead of app home", source.replace('/shopify/app"', '/shopify/install"')),
                ("automatic tunnel URL changes", source.replace('automatically_update_urls_on_dev = false', 'automatically_update_urls_on_dev = true')),
                ("untested API version", source.replace('api_version = "2026-07"', 'api_version = "2026-10"')),
                ("missing proxy permission", source.replace('scopes = "read_products,write_app_proxy"', 'scopes = "read_products"')),
                ("missing catalog permission", source.replace('scopes = "read_products,write_app_proxy"', 'scopes = "write_app_proxy"')),
                ("customer data expansion", source.replace('scopes = "read_products,write_app_proxy"', 'scopes = "read_products,write_app_proxy,read_customers"')),
                ("unencrypted app URL", source.replace('application_url = "https://', 'application_url = "http://')),
                ("credential in app URL", source.replace('application_url = "https://', 'application_url = "https://user:password@')),
                ("foreign callback", source.replace('"https://api.drapixai.com/shopify/callback"', '"https://other.example.invalid/shopify/callback"')),
                ("foreign storefront proxy", source.replace('url = "https://api.drapixai.com/shopify/storefront/proxy"', 'url = "https://other.example.invalid/proxy"')),
                ("incompatible storefront proxy path", source.replace('subpath = "drapixai"', 'subpath = "other"')),
                ("missing compliance topic", source.replace('"customers/data_request", ', '')),
                ("missing uninstall", source.replace('"app/uninstalled", ', '')),
                ("wrong callback path", source.replace('/shopify/callback', '/other/callback')),
                ("wrong proxy handler", source.replace('/shopify/storefront/proxy', '/other/proxy')),
                ("wrong webhook handler", source.replace('/shopify/webhooks', '/other/webhooks')),
                ("query-bearing endpoint", source.replace('/shopify/app"', '/shopify/app?token=bad"')),
                ("different callback port", source.replace('api.drapixai.com/shopify/callback', 'api.drapixai.com:8443/shopify/callback')),
            ]
            for label, text in cases:
                with self.subTest(label=label):
                    self.assertNotEqual(text, source)
                    config.write_text(text, encoding="utf-8")
                    self.assertTrue(validate(config, True), label)


if __name__ == "__main__":
    unittest.main()
