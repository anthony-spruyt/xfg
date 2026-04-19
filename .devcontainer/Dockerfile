FROM mcr.microsoft.com/devcontainers/base:jammy@sha256:0e50c6443341c5302ad4728049013750eb9ca35b1a3cbf003ba5fcbd5e033798

# Configure apt to retry on transient errors (e.g. Ubuntu mirror sync races
# where Packages.gz size mismatches the Release index for a few seconds).
# Placed in the base layer so all subsequent devcontainer feature installs
# inherit these retry semantics during envbuilder/kaniko build.
RUN printf 'Acquire::Retries "5";\nAcquire::http::Timeout "30";\nAcquire::http::Pipeline-Depth "0";\nAcquire::Retries::Delay::Maximum "10";\n' \
    > /etc/apt/apt.conf.d/80-retries

# Default to non-root. Devcontainer features explicitly USER root when
# installing; envbuilder/kaniko respects those directives. Final image
# defaulting to vscode matches remoteUser and satisfies trivy DS-0002.
USER vscode
