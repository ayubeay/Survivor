/**
 * Program IDL in camelCase format in order to be used in JS/TS.
 *
 * Note that this is only a type helper and is not the actual IDL. The original
 * IDL can be found at `target/idl/survivor.json`.
 */
export type Survivor = {
  "address": "Ca4DHFBvQ8PJurgZH5H5K7XaV4KiYYRcg4ZNDWcLLzNm",
  "metadata": {
    "name": "survivor",
    "version": "0.1.0",
    "spec": "0.1.0",
    "description": "Survivor - Autonomous risk, compliance, and payment resolution"
  },
  "instructions": [
    {
      "name": "challenge",
      "docs": [
        "Either party can challenge a proposed resolution within the 48h window.",
        "This escalates to human review."
      ],
      "discriminator": [
        16,
        107,
        14,
        39,
        244,
        150,
        81,
        187
      ],
      "accounts": [
        {
          "name": "challenger",
          "signer": true
        },
        {
          "name": "workContract",
          "writable": true
        }
      ],
      "args": []
    },
    {
      "name": "createWorkContract",
      "docs": [
        "Creates a new WorkContract between payer and payee.",
        "No funds move yet — this just establishes the agreement."
      ],
      "discriminator": [
        149,
        150,
        9,
        163,
        16,
        189,
        168,
        108
      ],
      "accounts": [
        {
          "name": "payer",
          "writable": true,
          "signer": true
        },
        {
          "name": "payee"
        },
        {
          "name": "survivorAuthority"
        },
        {
          "name": "mint"
        },
        {
          "name": "workContract",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  119,
                  111,
                  114,
                  107,
                  95,
                  99,
                  111,
                  110,
                  116,
                  114,
                  97,
                  99,
                  116
                ]
              },
              {
                "kind": "arg",
                "path": "contractId"
              }
            ]
          }
        },
        {
          "name": "vault",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  118,
                  97,
                  117,
                  108,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "workContract"
              }
            ]
          }
        },
        {
          "name": "vaultAuthority",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  118,
                  97,
                  117,
                  108,
                  116,
                  95,
                  97,
                  117,
                  116,
                  104,
                  111,
                  114,
                  105,
                  116,
                  121
                ]
              },
              {
                "kind": "account",
                "path": "workContract"
              }
            ]
          }
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        },
        {
          "name": "tokenProgram",
          "address": "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"
        },
        {
          "name": "rent",
          "address": "SysvarRent111111111111111111111111111111111"
        }
      ],
      "args": [
        {
          "name": "amount",
          "type": "u64"
        },
        {
          "name": "deadlineTs",
          "type": "i64"
        },
        {
          "name": "gracePeriodSeconds",
          "type": "i64"
        },
        {
          "name": "contractId",
          "type": "string"
        }
      ]
    },
    {
      "name": "executeResolution",
      "docs": [
        "Execute a resolution after the challenge window has passed (unchallenged),",
        "OR after human review for escalated disputes.",
        "Moves actual funds."
      ],
      "discriminator": [
        1,
        21,
        239,
        205,
        18,
        197,
        46,
        72
      ],
      "accounts": [
        {
          "name": "survivorAuthority",
          "signer": true
        },
        {
          "name": "workContract",
          "writable": true
        },
        {
          "name": "vault",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  118,
                  97,
                  117,
                  108,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "workContract"
              }
            ]
          }
        },
        {
          "name": "vaultAuthority",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  118,
                  97,
                  117,
                  108,
                  116,
                  95,
                  97,
                  117,
                  116,
                  104,
                  111,
                  114,
                  105,
                  116,
                  121
                ]
              },
              {
                "kind": "account",
                "path": "workContract"
              }
            ]
          }
        },
        {
          "name": "payerTokenAccount",
          "writable": true
        },
        {
          "name": "payeeTokenAccount",
          "writable": true
        },
        {
          "name": "tokenProgram",
          "address": "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"
        }
      ],
      "args": []
    },
    {
      "name": "fundWorkContract",
      "docs": [
        "Payer locks USDC into the contract vault."
      ],
      "discriminator": [
        179,
        99,
        255,
        192,
        213,
        240,
        223,
        209
      ],
      "accounts": [
        {
          "name": "payer",
          "writable": true,
          "signer": true
        },
        {
          "name": "workContract",
          "writable": true
        },
        {
          "name": "payerTokenAccount",
          "writable": true
        },
        {
          "name": "vault",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  118,
                  97,
                  117,
                  108,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "workContract"
              }
            ]
          }
        },
        {
          "name": "tokenProgram",
          "address": "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"
        }
      ],
      "args": []
    },
    {
      "name": "pause",
      "docs": [
        "Survivor authority pauses the contract during a dispute.",
        "Prevents any resolution until dispute is handled."
      ],
      "discriminator": [
        211,
        22,
        221,
        251,
        74,
        121,
        193,
        47
      ],
      "accounts": [
        {
          "name": "survivorAuthority",
          "signer": true
        },
        {
          "name": "workContract",
          "writable": true
        }
      ],
      "args": []
    },
    {
      "name": "reclaimAfterTimeout",
      "docs": [
        "Dead man's switch: payer reclaims funds if deadline + grace period has passed",
        "and no resolution was executed."
      ],
      "discriminator": [
        130,
        40,
        121,
        16,
        195,
        139,
        92,
        86
      ],
      "accounts": [
        {
          "name": "payer",
          "signer": true
        },
        {
          "name": "workContract",
          "writable": true
        },
        {
          "name": "vault",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  118,
                  97,
                  117,
                  108,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "workContract"
              }
            ]
          }
        },
        {
          "name": "vaultAuthority",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  118,
                  97,
                  117,
                  108,
                  116,
                  95,
                  97,
                  117,
                  116,
                  104,
                  111,
                  114,
                  105,
                  116,
                  121
                ]
              },
              {
                "kind": "account",
                "path": "workContract"
              }
            ]
          }
        },
        {
          "name": "payerTokenAccount",
          "writable": true
        },
        {
          "name": "tokenProgram",
          "address": "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"
        }
      ],
      "args": []
    },
    {
      "name": "resolve",
      "docs": [
        "Survivor authority proposes a resolution.",
        "Starts a 48-hour challenge window before funds move."
      ],
      "discriminator": [
        246,
        150,
        236,
        206,
        108,
        63,
        58,
        10
      ],
      "accounts": [
        {
          "name": "survivorAuthority",
          "signer": true
        },
        {
          "name": "workContract",
          "writable": true
        }
      ],
      "args": [
        {
          "name": "outcome",
          "type": {
            "defined": {
              "name": "resolutionOutcome"
            }
          }
        },
        {
          "name": "splitBpsPayee",
          "type": "u16"
        }
      ]
    }
  ],
  "accounts": [
    {
      "name": "workContract",
      "discriminator": [
        186,
        41,
        137,
        190,
        226,
        122,
        219,
        90
      ]
    }
  ],
  "events": [
    {
      "name": "contractCreated",
      "discriminator": [
        80,
        69,
        164,
        109,
        77,
        15,
        47,
        164
      ]
    },
    {
      "name": "contractFunded",
      "discriminator": [
        86,
        198,
        62,
        111,
        156,
        46,
        142,
        238
      ]
    },
    {
      "name": "contractPaused",
      "discriminator": [
        101,
        135,
        79,
        82,
        111,
        71,
        59,
        58
      ]
    },
    {
      "name": "contractReclaimed",
      "discriminator": [
        195,
        104,
        76,
        232,
        66,
        140,
        15,
        182
      ]
    },
    {
      "name": "contractResolved",
      "discriminator": [
        247,
        52,
        97,
        232,
        144,
        144,
        192,
        224
      ]
    },
    {
      "name": "resolutionChallenged",
      "discriminator": [
        134,
        252,
        105,
        19,
        175,
        223,
        45,
        16
      ]
    },
    {
      "name": "resolutionProposed",
      "discriminator": [
        209,
        21,
        193,
        193,
        218,
        234,
        131,
        108
      ]
    }
  ],
  "errors": [
    {
      "code": 6000,
      "name": "invalidAmount",
      "msg": "Invalid amount"
    },
    {
      "code": 6001,
      "name": "deadlineInPast",
      "msg": "Deadline must be in the future"
    },
    {
      "code": 6002,
      "name": "gracePeriodTooShort",
      "msg": "Grace period must be at least 72 hours"
    },
    {
      "code": 6003,
      "name": "contractIdTooLong",
      "msg": "Contract ID too long (max 32 chars)"
    },
    {
      "code": 6004,
      "name": "invalidStatus",
      "msg": "Invalid contract status for this operation"
    },
    {
      "code": 6005,
      "name": "unauthorized",
      "msg": "unauthorized"
    },
    {
      "code": 6006,
      "name": "invalidSplitBps",
      "msg": "Split basis points must be <= 10000"
    },
    {
      "code": 6007,
      "name": "challengeWindowOpen",
      "msg": "Challenge window still open"
    },
    {
      "code": 6008,
      "name": "challengeWindowClosed",
      "msg": "Challenge window has closed"
    },
    {
      "code": 6009,
      "name": "noResolutionSet",
      "msg": "No resolution has been set"
    },
    {
      "code": 6010,
      "name": "tooEarlyToReclaim",
      "msg": "Too early to reclaim — deadline + grace period not reached"
    },
    {
      "code": 6011,
      "name": "alreadyResolved",
      "msg": "Contract already resolved"
    },
    {
      "code": 6012,
      "name": "notFunded",
      "msg": "Contract not funded"
    },
    {
      "code": 6013,
      "name": "overflow",
      "msg": "Arithmetic overflow"
    }
  ],
  "types": [
    {
      "name": "contractCreated",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "workContract",
            "type": "pubkey"
          },
          {
            "name": "payer",
            "type": "pubkey"
          },
          {
            "name": "payee",
            "type": "pubkey"
          },
          {
            "name": "amount",
            "type": "u64"
          },
          {
            "name": "deadlineTs",
            "type": "i64"
          },
          {
            "name": "contractId",
            "type": "string"
          }
        ]
      }
    },
    {
      "name": "contractFunded",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "workContract",
            "type": "pubkey"
          },
          {
            "name": "amount",
            "type": "u64"
          },
          {
            "name": "timestamp",
            "type": "i64"
          }
        ]
      }
    },
    {
      "name": "contractPaused",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "workContract",
            "type": "pubkey"
          },
          {
            "name": "timestamp",
            "type": "i64"
          }
        ]
      }
    },
    {
      "name": "contractReclaimed",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "workContract",
            "type": "pubkey"
          },
          {
            "name": "payer",
            "type": "pubkey"
          },
          {
            "name": "amount",
            "type": "u64"
          },
          {
            "name": "timestamp",
            "type": "i64"
          }
        ]
      }
    },
    {
      "name": "contractResolved",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "workContract",
            "type": "pubkey"
          },
          {
            "name": "resolution",
            "type": {
              "defined": {
                "name": "resolution"
              }
            }
          },
          {
            "name": "timestamp",
            "type": "i64"
          }
        ]
      }
    },
    {
      "name": "contractStatus",
      "type": {
        "kind": "enum",
        "variants": [
          {
            "name": "created"
          },
          {
            "name": "funded"
          },
          {
            "name": "paused"
          },
          {
            "name": "pendingResolution"
          },
          {
            "name": "escalated"
          },
          {
            "name": "resolved"
          }
        ]
      }
    },
    {
      "name": "resolution",
      "type": {
        "kind": "enum",
        "variants": [
          {
            "name": "none"
          },
          {
            "name": "release"
          },
          {
            "name": "refund"
          },
          {
            "name": "split",
            "fields": [
              {
                "name": "bpsPayee",
                "type": "u16"
              }
            ]
          }
        ]
      }
    },
    {
      "name": "resolutionChallenged",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "workContract",
            "type": "pubkey"
          },
          {
            "name": "challenger",
            "type": "pubkey"
          },
          {
            "name": "timestamp",
            "type": "i64"
          }
        ]
      }
    },
    {
      "name": "resolutionOutcome",
      "type": {
        "kind": "enum",
        "variants": [
          {
            "name": "release"
          },
          {
            "name": "refund"
          },
          {
            "name": "split"
          }
        ]
      }
    },
    {
      "name": "resolutionProposed",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "workContract",
            "type": "pubkey"
          },
          {
            "name": "outcome",
            "type": {
              "defined": {
                "name": "resolutionOutcome"
              }
            }
          },
          {
            "name": "splitBpsPayee",
            "type": "u16"
          },
          {
            "name": "challengeDeadline",
            "type": "i64"
          },
          {
            "name": "timestamp",
            "type": "i64"
          }
        ]
      }
    },
    {
      "name": "workContract",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "payer",
            "type": "pubkey"
          },
          {
            "name": "payee",
            "type": "pubkey"
          },
          {
            "name": "survivorAuthority",
            "type": "pubkey"
          },
          {
            "name": "mint",
            "type": "pubkey"
          },
          {
            "name": "amount",
            "type": "u64"
          },
          {
            "name": "deadlineTs",
            "type": "i64"
          },
          {
            "name": "gracePeriodSeconds",
            "type": "i64"
          },
          {
            "name": "status",
            "type": {
              "defined": {
                "name": "contractStatus"
              }
            }
          },
          {
            "name": "resolution",
            "type": {
              "defined": {
                "name": "resolution"
              }
            }
          },
          {
            "name": "contractId",
            "type": "string"
          },
          {
            "name": "createdAt",
            "type": "i64"
          },
          {
            "name": "resolvedAt",
            "type": "i64"
          },
          {
            "name": "challengeDeadline",
            "type": "i64"
          },
          {
            "name": "bump",
            "type": "u8"
          },
          {
            "name": "vaultBump",
            "type": "u8"
          },
          {
            "name": "vaultAuthorityBump",
            "type": "u8"
          }
        ]
      }
    }
  ]
};
