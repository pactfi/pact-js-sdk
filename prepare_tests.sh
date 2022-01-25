#!/bin/sh

set -e

ALGOD_URL="http://localhost:8787"

ROOT_ACCOUNT_ADDRESS="P3YP3WOLTFNE64JAY7O4CODDYE56BODRRKDKW3TSZWHPANRMUYRPOSUNXY"
ROOT_ACCOUNT_MNEMONIC="jelly swear alcohol hybrid wrong camp prize attack hurdle shaft solar entry inner arm region economy awful inch they squirrel sort renew legend absorb giant"

USER_ACCOUNT_ADDRESS="QVQFRBEGEHG6MT2AEGXR22HMLRDRJGVH34B36FYTWP5X2XOOUXBTABQG6M"

docker-compose --file contracts_v1/docker-compose.yml down --remove-orphans
docker-compose --file contracts_v1/docker-compose.yml up -d algorand-node

docker-compose --file contracts_v1/docker-compose.yml exec -T algorand-node chmod 700 kmd
docker-compose --file contracts_v1/docker-compose.yml exec -T algorand-node chmod 700 devnet/primary/kmd-v0.5

./new_wallet.exp

docker-compose --file contracts_v1/docker-compose.yml exec -T algorand-node ./goal account import --mnemonic="$ROOT_ACCOUNT_MNEMONIC"
docker-compose --file contracts_v1/docker-compose.yml exec -T algorand-node ./goal asset create --total 1000000000 --unitname COIN --name COIN --decimals 6 --creator $ROOT_ACCOUNT_ADDRESS
docker-compose --file contracts_v1/docker-compose.yml exec -T algorand-node ./goal clerk send --from $ROOT_ACCOUNT_ADDRESS --to $USER_ACCOUNT_ADDRESS --fee 1000 -a 1000000000

cd contracts_v1
ALGOD_URL=http://localhost:8787 ALGOD_TOKEN=8cec5f4261a2b5ad831a8a701560892cabfe1f0ca00a22a37dee3e1266d726e3 DEPLOYER_MNEMONIC="$ROOT_ACCOUNT_MNEMONIC" poetry run python scripts/deploy.py --primary_asset_id=0 --secondary_asset_id=1 --fee_bps=30
cd ..
