# Coder workspaces set BASE_REGISTRY to Nexus.
ARG BASE_REGISTRY=docker.io
# renovate: datasource=docker depName=docker.io/aspruyt/devcontainer-common versioning=semver
FROM $BASE_REGISTRY/aspruyt/devcontainer-common:2.4.0@sha256:139b4412a1f07cd34894a2506580e507c041899505a5c98627eac9f7650c395b

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
