FROM mcr.microsoft.com/devcontainers/base:jammy@sha256:0e50c6443341c5302ad4728049013750eb9ca35b1a3cbf003ba5fcbd5e033798

# Configure apt to retry on transient errors (e.g. Ubuntu mirror sync races
# where Packages.gz size mismatches the Release index for a few seconds).
# Placed in the base layer so all subsequent devcontainer feature installs
# inherit these retry semantics during envbuilder/kaniko build.
RUN printf 'Acquire::Retries "5";\nAcquire::http::Timeout "30";\nAcquire::http::Pipeline-Depth "0";\nAcquire::Retries::Delay::Maximum "10";\n' \
    > /etc/apt/apt.conf.d/80-retries

# Route Ubuntu archive through Nexus apt-ubuntu-proxy when NEXUS_URL is
# supplied at build time. Coder workspaces inject it via envbuilder_env
# pointing at the in-cluster svc (http://nexus.nexus-system.svc.cluster.local:8081).
# Local devcontainers get no caching unless the user exports NEXUS_URL in
# their host shell env — the build falls through silently otherwise so the
# Dockerfile stays buildable offline and on first boot before Nexus is
# reachable. Scope: base-layer Ubuntu archive only — devcontainer features
# (nodesource, hashicorp, github-cli PPAs) manage their own apt source lists
# at install time. Ref #988.
ARG NEXUS_URL=""
RUN set -eu; \
    if [ -z "${NEXUS_URL}" ]; then \
        echo "NEXUS_URL unset — leaving /etc/apt/sources.list unchanged"; \
    else \
        echo "Routing Ubuntu archive through ${NEXUS_URL}/repository/apt-ubuntu-proxy/"; \
        printf 'deb %s/repository/apt-ubuntu-proxy/ jammy main restricted universe multiverse\ndeb %s/repository/apt-ubuntu-proxy/ jammy-updates main restricted universe multiverse\ndeb %s/repository/apt-ubuntu-proxy/ jammy-security main restricted universe multiverse\ndeb %s/repository/apt-ubuntu-proxy/ jammy-backports main restricted universe multiverse\n' \
            "${NEXUS_URL}" "${NEXUS_URL}" "${NEXUS_URL}" "${NEXUS_URL}" > /etc/apt/sources.list; \
    fi

# Default to non-root. Devcontainer features explicitly USER root when
# installing; envbuilder/kaniko respects those directives. Final image
# defaulting to vscode matches remoteUser and satisfies trivy DS-0002.
HEALTHCHECK NONE

USER vscode
