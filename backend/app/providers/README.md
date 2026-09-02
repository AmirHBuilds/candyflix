# providers/

Reserved for the `PlaybackSource` abstraction (Phase 5), per the
approved architecture:

- `base.py` — `PlaybackSource` ABC, `PlaybackCapabilities`, `PlaybackSourceResult`
- `registry.py` — `ProviderRegistry`
- `examples/example_provider_a.py`, `examples/example_provider_b.py` — mock providers

Not implemented yet — this is a project-skeleton placeholder. No real
third-party providers will ever be implemented per product decision;
only mock/example providers for development.
