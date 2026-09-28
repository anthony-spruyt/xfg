# renovate: datasource=docker depName=ghcr.io/anthony-spruyt/devcontainer-common versioning=semver
FROM ghcr.io/anthony-spruyt/devcontainer-common:2.0.1@sha256:f5863108fb3f2b98b9a5b3959f003ce4ba6cd85bce415aafedcd0b18348493b5

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
