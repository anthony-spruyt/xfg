# renovate: datasource=docker depName=ghcr.io/anthony-spruyt/devcontainer-common versioning=semver
FROM ghcr.io/anthony-spruyt/devcontainer-common@sha256:cd254a19926e433c935957821b4dc4b10d30b20db2917bd7ef87b2da5e2bd3de

# Route Ubuntu archive through Nexus apt-ubuntu-proxy when NEXUS_URL is
# supplied at build time. Coder workspaces inject it via envbuilder_env.
# Local devcontainers get no caching unless the user exports NEXUS_URL.
ARG NEXUS_URL=""
RUN set -eu; \
    if [ -z "${NEXUS_URL}" ]; then \
        echo "NEXUS_URL unset — leaving /etc/apt/sources.list unchanged"; \
    else \
        echo "Routing Ubuntu archive through ${NEXUS_URL}/repository/apt-ubuntu-proxy/"; \
        printf 'deb %s/repository/apt-ubuntu-proxy/ jammy main restricted universe multiverse\ndeb %s/repository/apt-ubuntu-proxy/ jammy-updates main restricted universe multiverse\ndeb %s/repository/apt-ubuntu-proxy/ jammy-security main restricted universe multiverse\ndeb %s/repository/apt-ubuntu-proxy/ jammy-backports main restricted universe multiverse\n' \
            "${NEXUS_URL}" "${NEXUS_URL}" "${NEXUS_URL}" "${NEXUS_URL}" > /etc/apt/sources.list; \
    fi

HEALTHCHECK NONE

USER vscode
