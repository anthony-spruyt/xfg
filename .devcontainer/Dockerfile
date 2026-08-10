# renovate: datasource=docker depName=ghcr.io/anthony-spruyt/devcontainer-common versioning=semver
FROM ghcr.io/anthony-spruyt/devcontainer-common@sha256:5e0b385790882e86daf7db640aefd4e0f46c5eaa43cf75f5515a737e3adb3ae8

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
