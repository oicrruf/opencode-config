FROM ghcr.io/anomalyco/opencode:2.2.7@sha256:7b1e3139a64121d12e572530974a18b9452967fb4d67516d8cfd9c0e763dd57d AS probe

ENV HOME=/tmp/at188-home \
    XDG_CONFIG_HOME=/tmp/at188-home/.config \
    XDG_DATA_HOME=/tmp/at188-home/.local/share \
    XDG_CACHE_HOME=/tmp/at188-home/.cache \
    OPENCODE_LOG_LEVEL=DEBUG

WORKDIR /fixture
COPY runtime-fixture.json /fixture/opencode.json
COPY .opencode/plugins/ /fixture/.opencode/plugins/
COPY runtime-probe/ /fixture/.opencode/plugins/runtime-probe/
ENTRYPOINT ["opencode", "serve", "--hostname", "0.0.0.0", "--port", "8080"]
