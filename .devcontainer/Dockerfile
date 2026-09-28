# renovate: datasource=docker depName=ghcr.io/anthony-spruyt/devcontainer-common versioning=semver
FROM ghcr.io/anthony-spruyt/devcontainer-common:1.2.48@sha256:0203fbcf8fbba2ff820f229390ca0fd387224f0e3646888d6b0cd67509dce424

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

USER 1001
