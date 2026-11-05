# SIWC local SDK snapshot

Source: https://github.com/openai/sign-in-with-chatgpt-devkit/tree/0a36fefeb913055c8c7a1a29b63d82b96b2e841a/packages/local/src

License: accompanying LICENSE (OpenAI DevKit Noncommercial License). This subtree retains its own license, independently of the application's MIT license.

The DevKit is a private workspace, not a published dependency. Vendored at the commit above. OAuth, OIDC verification, rotating refresh, locking and encrypted credential storage are unchanged. Local changes in types.ts, models.ts and responses.ts expose the documented Responses structured input/tools, completed function calls, usage/request ID and catalog context_window. No credentials are exposed. See official SIWC preview limitations for the supported request contract.

Cycle 1 additionally adapts these same inference-facing files for catalog input_modalities and bounded Responses input_image data URLs. Authentication/storage code is unchanged. One previously authorized synthetic session verified image input on November 4, 2026.
