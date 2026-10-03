# Coder workspaces set BASE_REGISTRY to Nexus; envbuilder ignores registry mirrors.
ARG BASE_REGISTRY=ghcr.io
# renovate: datasource=docker depName=ghcr.io/anthony-spruyt/devcontainer-common versioning=semver
FROM ${BASE_REGISTRY}/anthony-spruyt/devcontainer-common:2.2.1@sha256:f3f58e907ed5062bcfbb7d2eaad831729a10c6010cb9ea129e65b62d19caabbf

# Route Ubuntu archive through Nexus apt-ubuntu-proxy when NEXUS_URL is
# supplied at build time. Coder workspaces inject it via envbuilder_env.
# Local devcontainers get no caching unless the user exports NEXUS_URL.
ARG NEXUS_URL=""
RUN set -eu; \
    if [ -z "${NEXUS_URL}" ]; then \
        echo "NEXUS_URL unset — leaving apt sources unchanged"; \
    else \
        echo "Routing Ubuntu archive through ${NEXUS_URL}/repository/apt-ubuntu-proxy/"; \
        . /etc/os-release; \
        c="${VERSION_CODENAME}"; \
        { \
            echo "Types: deb"; \
            echo "URIs: ${NEXUS_URL}/repository/apt-ubuntu-proxy/"; \
            echo "Suites: ${c} ${c}-updates ${c}-security ${c}-backports"; \
            echo "Components: main restricted universe multiverse"; \
            echo "Signed-By: /usr/share/keyrings/ubuntu-archive-keyring.gpg"; \
        } > /etc/apt/sources.list.d/ubuntu.sources; \
        : > /etc/apt/sources.list; \
    fi

HEALTHCHECK NONE

USER 1001
