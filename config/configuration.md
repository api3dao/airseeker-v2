# Configuration

Airseeker can be configured via a combination of [environment variables](#environment-variables) and
[configuration files](#configuration-files).

## Environment variables

All of the environment variables are optional and or set with default values for convenience.

For example:

```sh
# Defines a logger suitable for production.
LOGGER_ENABLED=true
LOG_COLORIZE=false
LOG_FORMAT=json
LOG_LEVEL=info
```

or

```sh
# Defines a logger suitable for local development or testing.
LOGGER_ENABLED=true
LOG_COLORIZE=false
LOG_FORMAT=json
LOG_LEVEL=info
```

### `LOGGER_ENABLED` _(optional)_

Enables or disables logging. Options:

- `true` - Enables logging.
- `false` - Disables logging.

Default: `true`.

### `LOG_FORMAT` _(optional)_

The format of the log output. Options:

- `json` - Specifies JSON log format. This is suitable when running in production and streaming logs to other services.
- `pretty` - Logs are formatted in a human-friendly "pretty" way. Ideal, when running the service locally and in
  development.

Default: `json`.

### `LOG_COLORIZE` _(optional)_

Enables or disables colors in the log output. Options:

- `true` - Enables colors in the log output. The output has special color setting characters that are parseable by CLI.
  Recommended when running locally and in development.
- `false` - Disables colors in the log output. Recommended for production.

Default: `false`.

### `LOG_LEVEL` _(optional)_

Defines the minimum level of logs. Logs with smaller level (severity) will be silenced. Options:

- `debug` - Enables all logs.
- `info` - Enables logs with level `info`, `warn` and `error`.
- `warn` - Enables logs with level `warn` and `error`.
- `error` - Enables logs with level `error`.

Default: `info`.

### `LOG_HEARTBEAT` _(optional)_

Enables or disables the heartbeat log. The heartbeat log is a cryptographically secure log that is emitted every 60
seconds to indicate that the service is running. The log includes useful information such as the configuration hash.
Options:

- `true` - Enables the heartbeat log.
- `false` - Disables the heartbeat log.

## Configuration files

Airseeker needs two configuration files, `airseeker.json` and `secrets.env`. All expressions of a form `${SECRET_NAME}`
are referring to values from secrets and are interpolated inside the `airseeker.json` at runtime. You are advised to put
sensitive information inside secrets.

### `sponsorWalletMnemonic`

The mnemonic of the wallet used to derive sponsor wallets. Sponsor wallets are derived for each data feed separately. It
is recommended to interpolate this value from secrets. For example:

```jsonc
// The mnemonic is interpolated from the "SPONSOR_WALLET_MNEMONIC" secret.
"sponsorWalletMnemonic": "${SPONSOR_WALLET_MNEMONIC}",
```

### `chains`

A record of chain configurations. The record key is the chain ID. For example:

```jsonc
{
  // Defines a chain configuration with ID 1 (ETH mainnet).
  "1": {
    "providers": {
      "mainnet": {
        "url": "http://mainnet.com",
      },
    },
  },
}
```

#### `alias` _(optional)_

The optional alias to identify the chain in logs. If not provided, the chain alias from `@api3/chains` is used. If there
is no record in `@api3/chains` for the given chain ID, falls back to using `unknown`.

#### `contracts`

A record of contract addresses used by Airseeker.

##### `Api3ServerV1` _(optional)_

The address of the Api3ServerV1 contract. If not specified, the address is loaded from the
[Airnode protocol v1](https://github.com/api3dao/airnode-protocol-v1) repository.

##### `AirseekerRegistry`

The address of the AirseekerRegistry contract.

#### `providers`

A record of providers. The record key is the provider name. Provider name is only used for internal purposes and to
uniquely identify the provider for the given chain.

##### `providers[<NAME>]`

A provider configuration.

###### `url`

The URL of the provider.

#### `gasSettings`

The settings used to calculate gas prices used to submit transactions. The gas oracle is stateful and maintains
historical gas prices for a specific sampling window. It computes the gas price to be used based on the latest gas
price. In case the transaction is a retry of a pending transaction, the latest gas price is linearly scaled by a factor
up to a specified maximum. In case the transaction is not a retry, the latest gas price is multiplied only by the
recommended gas price multiplier. The sanitization cap is computed as a percentile chosen from the historical gas prices
multiplied by a specified gas price multiplier. The sanitization cap provides the upper bound for the computed gas
price.

Example of a scaling computation:

```js
// Parameters:
// - recommendedGasPriceMultiplier = 1.2
// - maxScalingMultiplier = 2
// - scalingWindow = 300
//
// Say there is a pending transaction for 150 seconds.
//
// The scaling factor is calculated as:
1.2 + (2 - 1.2) * (2.5 / 5) = 1.6
```

##### `recommendedGasPriceMultiplier`

The base multiplier used to compute the gas price. Used to multiply the latest gas price.

##### `sanitizationSamplingWindow`

The number of seconds for which to keep historical gas prices.

##### `sanitizationPercentile`

The percentile of gas historical prices to use for sanitization of the latest gas price.

##### `scalingWindow`

The period in seconds used to scale the retry of a pending update transaction. The transaction is scaled linearly up to
the `maxScalingMultiplier`.

##### `maxScalingMultiplier`

The maximum scaling multiplier. The gas price will not be scaled by a larger factor independently of how long is the
update pending.

##### `sanitizationMultiplier`

The multiplier used during sanitization. The percentile gas price computed during sanitization is multiplied by this
factor and the result is used to cap the gas price.

#### `deviationThresholdCoefficient` _(optional)_

The global coefficient applied to all deviation checks. Used to differentiate alternate deployments. For example:

```jsonc
"deviationThresholdCoefficient": 1,
```

Defaults to `1`.

#### `asyncBeaconUpdatedeviationThresholdFactor` _(optional)_

The global deviation factor applied to async beacon updates deviation checks. When configured, this value will be used
on beacons sets that don't require an update but some of its beacon constituents do. So if a beacon set has a 1%
deviation threshold, Airseeker will only update its beacons when deviation of each beacon exeeds (1 \*
asyncBeaconUpdatedeviationThresholdFactor)%. For example:

```jsonc
"asyncBeaconUpdatedeviationThresholdFactor": 5,
```

Defaults to `1`.

#### `heartbeatIntervalModifier` _(optional)_

The global modifier applied to all heartbeat checks. The value is specified in seconds and can be positive or negative.
The resulting interval is calculated by adding this modifier as an offset and clamped to a minimum of 0, ensuring it
never goes negative. Used to differentiate alternate deployments. For example:

```jsonc
"heartbeatIntervalModifier": -120,
```

Defaults to `0`.

#### `dataFeedUpdateInterval`

The interval specifying how often to run the data feed update loop. In seconds.

#### `dataFeedBatchSize`

The batch size of active data feeds that are to be fetched in a single RPC call.

#### `fallbackGasLimit` _(optional)_

The fallback gas limit used when the gas limit estimation using the RPC provider fails. If not specified, Airseeker will
only rely on the RPC provider for gas limit estimation and will skip an update if this fails.

### `signedDataFetchInterval`

The fetch interval in seconds between retrievals of signed API data.

### `signedApiUrls`

A list of signed API URLs to call along with URLs fetched from the chain.

### `walletDerivationScheme`

The derivation scheme configuration used to derive sponsor wallets.

#### `type`

The following options are available:

- `self-funded` - The sponsor wallet is derived from the hash of the encoded beacon ID together with the update
  parameters. This is the scheme that was originally used by Nodary for self-funded data feeds.
- `managed` - Derives the wallet from the hash of the dAPI name (or data feed ID). This means the wallet derivation is
  agnostic to update parameters, and the same wallet is used when the dAPI is upgraded/downgraded.
- `fixed` - Derives the wallet from the specified `sponsorAddress`. All data feed updates will be done via this single
  wallet.

### `stage`

An identifier of the deployment stage. This is used to distinguish between different deployments, for example `dev`,
`prod-1` or `prod-2`. The stage value can have 256 characters at maximum and can only include lowercase alphanumeric
characters and hyphens.

### `version`

The version specified in the config must match the version of the Airseeker Docker image at deployment time.
