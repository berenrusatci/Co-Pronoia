{
  description = "Co-Pronoia development environment";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";
  };

  outputs = { self, nixpkgs }:
    let
      systems = [
        "x86_64-linux"
        "aarch64-linux"
      ];

      forAllSystems = f:
        nixpkgs.lib.genAttrs systems
          (system: f (import nixpkgs { inherit system; }));
    in
    {
      devShells = forAllSystems (pkgs: {
        default = pkgs.mkShell {
          packages = with pkgs; [
            nodejs
            git
            git-lfs
            jq
            ripgrep
            curl
            openssl # Prisma engine'leri libssl'e bakar

            # Docker'sız ortamlar (Termux/proot Ubuntu, ARM) için yerel Postgres:
            # docker compose yerine `pg-up` / `pg-down` kullanılır.
            postgresql_16

            gcc
            gnumake
            pkg-config
            python3
          ];

          # Repo-yerel Postgres kümesi; docker-compose.yml ile aynı kullanıcı/parola/veritabanı
          # ve aynı port (5433), yani server/.env'deki DATABASE_URL değişmeden çalışır.
          shellHook = ''
            export PGDATA="$PWD/.pgdata"
            export PGHOST=127.0.0.1
            export PGPORT=5433
            export PGUSER=treemapper
            export PGDATABASE=treemapper
            export PGPASSWORD=treemapper # yalnız bu repo-yerel geliştirme kümesi için

            pg-up() {
              if [ ! -d "$PGDATA" ]; then
                initdb --username="$PGUSER" --pwfile=<(echo treemapper) --auth=md5 || return 1
                echo "unix_socket_directories = '$PGDATA'" >> "$PGDATA/postgresql.conf"
              fi
              pg_ctl -o "-p $PGPORT -k '$PGDATA' -h 127.0.0.1" -l "$PGDATA/postgres.log" start || return 1
              createdb -h "$PGDATA" "$PGDATABASE" 2>/dev/null || true
              echo "postgres hazır: 127.0.0.1:$PGPORT/$PGDATABASE"
            }
            pg-down() { pg_ctl stop; }
            export -f pg-up pg-down 2>/dev/null || true
          '';
        };
      });
    };
}
