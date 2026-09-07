"""Validate reviewed Compose templates structurally, not live network exposure."""

from __future__ import annotations

import re
import yaml

DIGEST_IMAGE = re.compile(r"[a-z0-9][a-z0-9._:/-]*@sha256:[a-f0-9]{64}")
PYTORCH_IMAGE = re.compile(r"pytorch/pytorch:[A-Za-z0-9._-]+@sha256:[a-f0-9]{64}")
PROFILE = "../release/standard-catvton-rc1.env"
IMAGES = {
    "edge": {"postgres": "DRAPIXAI_POSTGRES_IMAGE", "redis": "DRAPIXAI_REDIS_IMAGE",
             "minio": "DRAPIXAI_MINIO_IMAGE", "minio-init": "DRAPIXAI_MINIO_MC_IMAGE",
             "api": "DRAPIXAI_API_RELEASE_IMAGE", "web": "DRAPIXAI_WEB_RELEASE_IMAGE"},
    "ai": {"redis": "DRAPIXAI_REDIS_IMAGE", "ai-api": "DRAPIXAI_AI_RELEASE_IMAGE",
           "ai-worker": "DRAPIXAI_AI_RELEASE_IMAGE"},
}
NETWORKS = {
    "edge": {"postgres": {"data"}, "redis": {"data"}, "minio": {"data"},
             "minio-init": {"data"}, "api": {"edge", "data"}, "web": {"edge"}},
    "ai": {"redis": {"ai-private"}, "ai-api": {"ai-private"}, "ai-worker": {"ai-private"}},
}
PORTS = {
    ("edge", "api"): "127.0.0.1:${DRAPIXAI_STAGING_API_PORT:-18000}:8000",
    ("edge", "web"): "127.0.0.1:${DRAPIXAI_STAGING_WEB_PORT:-13000}:3000",
    ("ai", "ai-api"): "127.0.0.1:${DRAPIXAI_STAGING_AI_PORT:-18080}:8080",
}
REQUIRED_PRIVATE_MOUNTS = {
    ("edge", "postgres"): {"postgres_password", "api_database_password"},
    ("edge", "redis"): {"redis_password"},
    ("edge", "minio"): {"minio_root_user", "minio_root_password"},
    ("edge", "minio-init"): {"minio_root_user", "minio_root_password"},
    ("ai", "redis"): {"ai_redis_password"},
}


class UniqueLoader(yaml.SafeLoader):
    pass


def unique_mapping(loader, node, deep=False):
    result = {}
    for key_node, value_node in node.value:
        key = loader.construct_object(key_node, deep=deep)
        if not isinstance(key, str) or key in result:
            raise ValueError("Compose mappings require unique string keys")
        result[key] = loader.construct_object(value_node, deep=deep)
    return result


UniqueLoader.add_constructor(yaml.resolver.BaseResolver.DEFAULT_MAPPING_TAG, unique_mapping)


def load_compose(source: str) -> dict:
    result = yaml.load(source, Loader=UniqueLoader)
    if not isinstance(result, dict):
        raise ValueError("Compose document must be a mapping")
    return result


def environment(value) -> dict:
    if value is None:
        return {}
    if isinstance(value, dict):
        return value
    if not isinstance(value, list):
        raise ValueError("environment must be mapping or list")
    result = {}
    for item in value:
        if not isinstance(item, str) or "=" not in item:
            raise ValueError("environment requires explicit KEY=value entries")
        key, setting = item.split("=", 1)
        if key in result:
            raise ValueError("duplicate environment key")
        result[key] = setting
    return result


def validate(edge: dict, ai: dict, images: dict, api_env: dict, profile: dict) -> dict:
    controls = {key: True for key in (
        "data_services_have_no_host_ports", "web_and_api_origins_are_loopback_only",
        "gpu_origin_is_loopback_only", "private_networks_are_isolated",
        "standard_release_profile_is_loaded", "application_release_images_are_digest_pinned",
        "all_staging_service_images_are_digest_pinned", "staging_deploys_without_source_builds",
        "api_to_gpu_mtls_is_configured", "staging_environment_is_restricted",
        "reviewed_topology_is_preserved", "secret_mounts_are_read_only",
    )}
    failures = []
    secret_sources = set()

    def check(ok, control, message):
        if not ok:
            controls[control] = False
            failures.append(message)

    for label, document in (("edge", edge), ("ai", ai)):
        services = document.get("services", {})
        if not isinstance(services, dict):
            services = {}
        check(set(services) == set(IMAGES[label]), "reviewed_topology_is_preserved",
              f"{label}: service inventory must match reviewed topology")
        check(not any(key in document for key in ("include", "extends")),
              "reviewed_topology_is_preserved", f"{label}: external composition is not reviewed")
        networks = document.get("networks", {})
        private = "data" if label == "edge" else "ai-private"
        expected = {"edge", "data"} if label == "edge" else {"ai-private"}
        network_ok = isinstance(networks, dict) and set(networks) == expected
        if network_ok:
            config = networks.get(private)
            network_ok = isinstance(config, dict) and config.get("internal") is True
            network_ok = network_ok and all(
                value is None or (isinstance(value, dict) and not value.get("external")
                                  and value.get("driver", "bridge") == "bridge"
                                  and not value.get("driver_opts"))
                for value in networks.values()
            )
        check(network_ok, "private_networks_are_isolated", f"{label}: private network configuration changed")

        for name, variable in IMAGES[label].items():
            service = services.get(name)
            service = service if isinstance(service, dict) else {}
            prefix = f"{label}:{name}"
            isolated = "network_mode" not in service and not service.get("privileged")
            check(isolated and "extends" not in service, "reviewed_topology_is_preserved",
                  f"{prefix}: shared/host network, privileged mode or extends is forbidden")
            attached = service.get("networks", [])
            valid_attachment = isinstance(attached, (dict, list)) and all(isinstance(k, str) for k in attached)
            check(valid_attachment and set(attached) == NETWORKS[label][name] and isolated,
                  "private_networks_are_isolated", f"{prefix}: unreviewed network attachment")
            port = PORTS.get((label, name))
            control = ("web_and_api_origins_are_loopback_only" if label == "edge"
                       else "gpu_origin_is_loopback_only") if port else "data_services_have_no_host_ports"
            check(service.get("ports", []) == ([port] if port else []) and isolated,
                  control, f"{prefix}: ports must be {'the single reviewed loopback binding' if port else 'absent'}")
            pinned = (service.get("image") == "${" + variable + ":?set " + variable + "}"
                      and bool(DIGEST_IMAGE.fullmatch(images.get(variable, ""))))
            check(pinned, "all_staging_service_images_are_digest_pinned", f"{prefix}: must use digest-pinned {variable}")
            if "RELEASE_IMAGE" in variable:
                check(pinned, "application_release_images_are_digest_pinned", f"{prefix}: release image is not pinned")
            check("build" not in service, "staging_deploys_without_source_builds",
                  f"{prefix}: staging Compose must deploy immutable release artifacts without source builds")

            mounts = service.get("volumes", [])
            mount_ok = isinstance(mounts, list) and not any(
                key in service for key in ("volumes_from", "secrets", "configs")
            )
            targets = []
            if mount_ok:
                for mount in mounts:
                    # Unknown mount forms require review rather than bypassing checks.
                    if not isinstance(mount, str) or len(mount.split(":")) < 2:
                        mount_ok = False
                        continue
                    parts = mount.split(":")
                    source, target = parts[:2]
                    targets.append(target)
                    if target in ("/", "/run", "/run/secrets") or "docker.sock" in mount:
                        mount_ok = False
                    if target.startswith("/run/secrets/"):
                        mount_ok = mount_ok and len(parts) == 3 and parts[2] == "ro" and bool(
                            re.fullmatch(r"\./private/[A-Za-z0-9_-][A-Za-z0-9_.-]*", source)
                        )
                        secret_sources.add(source)
                mount_ok = mount_ok and len(targets) == len(set(targets))
            if isinstance(mounts, list):
                for filename in REQUIRED_PRIVATE_MOUNTS.get((label, name), set()):
                    mount_ok = mount_ok and f"./private/{filename}:/run/secrets/{filename}:ro" in mounts
            tmpfs = service.get("tmpfs", [])
            if not isinstance(tmpfs, list) or any(
                not isinstance(item, str) or item.split(":", 1)[0] in ("/", "/run", "/run/secrets")
                or item.startswith("/run/secrets/") for item in tmpfs
            ):
                mount_ok = False
            check(mount_ok, "secret_mounts_are_read_only", f"{prefix}: unsafe, duplicate or unsupported mount")
            if label == "edge" and name == "api":
                check(mount_ok, "api_to_gpu_mtls_is_configured", "edge:api: mTLS mounts may be obscured or writable")
            if label == "ai" and name in ("ai-api", "ai-worker"):
                try:
                    settings = environment(service.get("environment"))
                    settings_ok = all(str(settings[key]) == value for key, value in profile.items() if key in settings)
                except ValueError:
                    settings_ok = False
                check(service.get("env_file") == ["../env/ai.staging.env", PROFILE] and settings_ok,
                      "standard_release_profile_is_loaded", f"{prefix}: Standard profile must be last and not overridden")

    api = edge.get("services", {}).get("api", {}) if isinstance(edge.get("services"), dict) else {}
    api = api if isinstance(api, dict) else {}
    mounts = api.get("volumes", [])
    for filename, target in (
        ("drapixai-api.json", "drapixai-api"),
        ("drapixai-internal-ca.pem", "drapixai-internal-ca.pem"),
        ("drapixai-ai-client.crt", "drapixai-ai-client.crt"),
        ("drapixai-ai-client.key", "drapixai-ai-client.key"),
    ):
        ok = isinstance(mounts, list) and f"./private/{filename}:/run/secrets/{target}:ro" in mounts
        check(ok, "secret_mounts_are_read_only", f"edge:api: missing read-only {filename} mount")
        if filename != "drapixai-api.json":
            check(ok, "api_to_gpu_mtls_is_configured", f"edge:api: missing mTLS {filename} mount")
    required = {
        "DRAPIXAI_API_ENVIRONMENT": "sandbox", "DRAPIXAI_SECRETS_PROVIDER": "mounted-file",
        "DRAPIXAI_AI_PRIVATE_NETWORK": "1", "DRAPIXAI_AI_MTLS_ENABLED": "1",
        "DRAPIXAI_ALLOW_LOCAL_STORAGE_FALLBACK": "0", "DRAPIXAI_ALLOW_LEGACY_API_KEYS": "0",
        "DRAPIXAI_ENABLE_LOWER_BODY": "0",
    }
    try:
        overrides = environment(api.get("environment"))
    except ValueError:
        overrides = {}
        check(False, "staging_environment_is_restricted", "edge:api: invalid environment")
    check(api.get("env_file") == ["../env/api.staging.env"], "staging_environment_is_restricted",
          "edge:api: environment file must not be replaced or overridden")
    for key, value in required.items():
        ok = api_env.get(key) == value and (key not in overrides or str(overrides[key]) == value)
        check(ok, "staging_environment_is_restricted", f"API staging environment must set {key}={value}")
        if key in ("DRAPIXAI_AI_PRIVATE_NETWORK", "DRAPIXAI_AI_MTLS_ENABLED"):
            check(ok, "api_to_gpu_mtls_is_configured", f"API mTLS environment is unsafe: {key}")
    check(bool(re.fullmatch(r"[a-f0-9]{40}", images.get("DRAPIXAI_RELEASE_COMMIT", ""))),
          "application_release_images_are_digest_pinned", "staging images must record a 40-character release commit")
    for key in ("DRAPIXAI_AI_BUILD_IMAGE", "DRAPIXAI_AI_RUNTIME_IMAGE"):
        check(bool(PYTORCH_IMAGE.fullmatch(images.get(key, ""))),
              "all_staging_service_images_are_digest_pinned", f"staging images must record official digest for {key}")
    return {"passed": not failures, "controls": controls, "failures": failures,
            "secret_sources": sorted(secret_sources)}
