/**
 * Program IDL in camelCase format in order to be used in JS/TS.
 *
 * Note that this is only a type helper and is not the actual IDL. The original
 * IDL can be found at `target/idl/cardcade_marketplace.json`.
 */
export type CardcadeMarketplace = {
  "address": "HcMUewaCXRFMi8KAwBwgRRdScJ5Z4KSffqtYG6Dmpfzk",
  "metadata": {
    "name": "cardcadeMarketplace",
    "version": "0.1.0",
    "spec": "0.1.0",
    "description": "Cardcade card marketplace on Solana (USDC-only). Supports primary sales and P2P sales with configurable buyer/seller fees."
  },
  "docs": [
    "Cardcade Marketplace — USDC-only card marketplace.",
    "",
    "## Fees",
    "",
    "* **Buyer fee:** flat `buyer_fee_bps` charged on top of every purchase.",
    "Holders of a `BuyerWaiver` PDA pay 0%. The waiver PDA is admin-only;",
    "its address is derived from the buyer's pubkey, so users cannot spoof",
    "one.",
    "* **Seller fee:** group-tiered. Each seller can be assigned to a",
    "`SellerGroup` (e.g. group 0 = 4 %, group 1 = 3.5 %, …). New sellers",
    "default to group 0.",
    "* **Shipping:** sent in the same `pay_invoice` call as the item amount;",
    "passed through to the seller. Fees are computed against the item",
    "amount ONLY, never against shipping.",
    "* **CardCade-as-seller:** when the seller wallet equals the marketplace",
    "`authority`, the seller fee is automatically 0% (the platform never",
    "charges itself). The buyer fee is unaffected.",
    "",
    "### Worked example",
    "",
    "Invoice: amount 100 USDC, shipping 10 USDC.",
    "Seller is in group 0 (4 %). Buyer is not waived (0.5 %).",
    "",
    "```text",
    "buyer pays  = 100 + 10 + 0.5 = 110.50",
    "seller gets = 100 - 4   + 10 = 106.00",
    "treasury    = 4   + 0.5      =   4.50",
    "```"
  ],
  "instructions": [
    {
      "name": "grantBuyerWaiver",
      "discriminator": [
        126,
        201,
        96,
        19,
        224,
        229,
        246,
        33
      ],
      "accounts": [
        {
          "name": "authority",
          "writable": true,
          "signer": true,
          "relations": [
            "marketplace"
          ]
        },
        {
          "name": "marketplace",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  109,
                  97,
                  114,
                  107,
                  101,
                  116,
                  112,
                  108,
                  97,
                  99,
                  101
                ]
              }
            ]
          }
        },
        {
          "name": "buyer"
        },
        {
          "name": "waiver",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  98,
                  117,
                  121,
                  101,
                  114,
                  95,
                  119,
                  97,
                  105,
                  118,
                  101,
                  114
                ]
              },
              {
                "kind": "account",
                "path": "buyer"
              }
            ]
          }
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": []
    },
    {
      "name": "grantCryptoSeller",
      "discriminator": [
        120,
        69,
        107,
        57,
        185,
        118,
        179,
        176
      ],
      "accounts": [
        {
          "name": "authority",
          "writable": true,
          "signer": true,
          "relations": [
            "marketplace"
          ]
        },
        {
          "name": "marketplace",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  109,
                  97,
                  114,
                  107,
                  101,
                  116,
                  112,
                  108,
                  97,
                  99,
                  101
                ]
              }
            ]
          }
        },
        {
          "name": "seller"
        },
        {
          "name": "allowance",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  114,
                  121,
                  112,
                  116,
                  111,
                  95,
                  115,
                  101,
                  108,
                  108,
                  101,
                  114
                ]
              },
              {
                "kind": "account",
                "path": "seller"
              }
            ]
          }
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": []
    },
    {
      "name": "initializeMarketplace",
      "discriminator": [
        47,
        81,
        64,
        0,
        96,
        56,
        105,
        7
      ],
      "accounts": [
        {
          "name": "authority",
          "writable": true,
          "signer": true
        },
        {
          "name": "marketplace",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  109,
                  97,
                  114,
                  107,
                  101,
                  116,
                  112,
                  108,
                  97,
                  99,
                  101
                ]
              }
            ]
          }
        },
        {
          "name": "defaultGroup",
          "docs": [
            "Default seller group (id 0). Created atomically with the",
            "marketplace so that buy_card always has a fallback group."
          ],
          "writable": true
        },
        {
          "name": "paymentMint",
          "docs": [
            "USDC mint — set once at init and immutable thereafter."
          ]
        },
        {
          "name": "treasury",
          "docs": [
            "Treasury USDC token account that receives fees + primary proceeds."
          ]
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
          "name": "params",
          "type": {
            "defined": {
              "name": "initializeMarketplaceParams"
            }
          }
        }
      ]
    },
    {
      "name": "payInvoice",
      "discriminator": [
        104,
        6,
        62,
        239,
        197,
        206,
        208,
        220
      ],
      "accounts": [
        {
          "name": "buyer",
          "writable": true,
          "signer": true
        },
        {
          "name": "seller",
          "docs": [
            "authorise the seller_payment_account owner."
          ]
        },
        {
          "name": "marketplace",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  109,
                  97,
                  114,
                  107,
                  101,
                  116,
                  112,
                  108,
                  97,
                  99,
                  101
                ]
              }
            ]
          }
        },
        {
          "name": "paymentMint",
          "docs": [
            "USDC mint — must match marketplace config."
          ]
        },
        {
          "name": "buyerPaymentAccount",
          "writable": true
        },
        {
          "name": "sellerPaymentAccount",
          "writable": true
        },
        {
          "name": "treasuryPaymentAccount",
          "writable": true
        },
        {
          "name": "sellerProfile",
          "docs": [
            "Optional `SellerProfile`. Seed-verified; if uninitialised we fall",
            "back to the default group. If present and `override_fee_bps` is",
            "`Some(x)`, that overrides the group's fee."
          ],
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  115,
                  101,
                  108,
                  108,
                  101,
                  114,
                  95,
                  112,
                  114,
                  111,
                  102,
                  105,
                  108,
                  101
                ]
              },
              {
                "kind": "account",
                "path": "seller"
              }
            ]
          }
        },
        {
          "name": "sellerGroup",
          "docs": [
            "`SellerGroup` whose `group_id` matches the seller's profile (or",
            "`DEFAULT_SELLER_GROUP_ID` when no profile exists)."
          ]
        },
        {
          "name": "buyerWaiver",
          "docs": [
            "Optional `BuyerWaiver`. Seed-verified; existence waives the buyer",
            "fee."
          ],
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  98,
                  117,
                  121,
                  101,
                  114,
                  95,
                  119,
                  97,
                  105,
                  118,
                  101,
                  114
                ]
              },
              {
                "kind": "account",
                "path": "buyer"
              }
            ]
          }
        },
        {
          "name": "cryptoSellerAllowance",
          "docs": [
            "`CryptoSellerAllowance` PDA. Required to exist and be owned by the",
            "program UNLESS `seller == marketplace.authority`. Seed-verified."
          ],
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  114,
                  121,
                  112,
                  116,
                  111,
                  95,
                  115,
                  101,
                  108,
                  108,
                  101,
                  114
                ]
              },
              {
                "kind": "account",
                "path": "seller"
              }
            ]
          }
        },
        {
          "name": "invoice",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  105,
                  110,
                  118,
                  111,
                  105,
                  99,
                  101
                ]
              },
              {
                "kind": "arg",
                "path": "invoiceId"
              }
            ]
          }
        },
        {
          "name": "tokenProgram",
          "address": "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": [
        {
          "name": "invoiceId",
          "type": {
            "array": [
              "u8",
              16
            ]
          }
        },
        {
          "name": "amount",
          "type": "u64"
        },
        {
          "name": "shipping",
          "type": "u64"
        }
      ]
    },
    {
      "name": "revokeBuyerWaiver",
      "discriminator": [
        64,
        222,
        158,
        8,
        85,
        176,
        1,
        67
      ],
      "accounts": [
        {
          "name": "authority",
          "writable": true,
          "signer": true,
          "relations": [
            "marketplace"
          ]
        },
        {
          "name": "marketplace",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  109,
                  97,
                  114,
                  107,
                  101,
                  116,
                  112,
                  108,
                  97,
                  99,
                  101
                ]
              }
            ]
          }
        },
        {
          "name": "buyer",
          "relations": [
            "waiver"
          ]
        },
        {
          "name": "waiver",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  98,
                  117,
                  121,
                  101,
                  114,
                  95,
                  119,
                  97,
                  105,
                  118,
                  101,
                  114
                ]
              },
              {
                "kind": "account",
                "path": "buyer"
              }
            ]
          }
        }
      ],
      "args": []
    },
    {
      "name": "revokeCryptoSeller",
      "discriminator": [
        145,
        188,
        32,
        175,
        79,
        159,
        33,
        133
      ],
      "accounts": [
        {
          "name": "authority",
          "writable": true,
          "signer": true,
          "relations": [
            "marketplace"
          ]
        },
        {
          "name": "marketplace",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  109,
                  97,
                  114,
                  107,
                  101,
                  116,
                  112,
                  108,
                  97,
                  99,
                  101
                ]
              }
            ]
          }
        },
        {
          "name": "seller",
          "relations": [
            "allowance"
          ]
        },
        {
          "name": "allowance",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  114,
                  121,
                  112,
                  116,
                  111,
                  95,
                  115,
                  101,
                  108,
                  108,
                  101,
                  114
                ]
              },
              {
                "kind": "account",
                "path": "seller"
              }
            ]
          }
        }
      ],
      "args": []
    },
    {
      "name": "setPaused",
      "discriminator": [
        91,
        60,
        125,
        192,
        176,
        225,
        166,
        218
      ],
      "accounts": [
        {
          "name": "authority",
          "signer": true,
          "relations": [
            "marketplace"
          ]
        },
        {
          "name": "marketplace",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  109,
                  97,
                  114,
                  107,
                  101,
                  116,
                  112,
                  108,
                  97,
                  99,
                  101
                ]
              }
            ]
          }
        }
      ],
      "args": [
        {
          "name": "paused",
          "type": "bool"
        }
      ]
    },
    {
      "name": "setSellerGroup",
      "docs": [
        "Assign / move a seller into a group. Creates the `SellerProfile`",
        "PDA if missing (init_if_needed)."
      ],
      "discriminator": [
        146,
        92,
        3,
        15,
        21,
        42,
        151,
        107
      ],
      "accounts": [
        {
          "name": "authority",
          "writable": true,
          "signer": true,
          "relations": [
            "marketplace"
          ]
        },
        {
          "name": "marketplace",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  109,
                  97,
                  114,
                  107,
                  101,
                  116,
                  112,
                  108,
                  97,
                  99,
                  101
                ]
              }
            ]
          }
        },
        {
          "name": "seller",
          "docs": [
            "The seller being assigned. Not a signer — admin moves them."
          ]
        },
        {
          "name": "profile",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  115,
                  101,
                  108,
                  108,
                  101,
                  114,
                  95,
                  112,
                  114,
                  111,
                  102,
                  105,
                  108,
                  101
                ]
              },
              {
                "kind": "account",
                "path": "seller"
              }
            ]
          }
        },
        {
          "name": "group",
          "docs": [
            "Target group. Must already exist (created via upsert_seller_group)."
          ]
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": [
        {
          "name": "groupId",
          "type": "u8"
        }
      ]
    },
    {
      "name": "setSellerOverrideFee",
      "discriminator": [
        26,
        8,
        167,
        165,
        229,
        123,
        64,
        244
      ],
      "accounts": [
        {
          "name": "authority",
          "writable": true,
          "signer": true,
          "relations": [
            "marketplace"
          ]
        },
        {
          "name": "marketplace",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  109,
                  97,
                  114,
                  107,
                  101,
                  116,
                  112,
                  108,
                  97,
                  99,
                  101
                ]
              }
            ]
          }
        },
        {
          "name": "seller"
        },
        {
          "name": "profile",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  115,
                  101,
                  108,
                  108,
                  101,
                  114,
                  95,
                  112,
                  114,
                  111,
                  102,
                  105,
                  108,
                  101
                ]
              },
              {
                "kind": "account",
                "path": "seller"
              }
            ]
          }
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": [
        {
          "name": "overrideFeeBps",
          "type": {
            "option": "u16"
          }
        }
      ]
    },
    {
      "name": "updateAuthority",
      "discriminator": [
        32,
        46,
        64,
        28,
        149,
        75,
        243,
        88
      ],
      "accounts": [
        {
          "name": "authority",
          "signer": true,
          "relations": [
            "marketplace"
          ]
        },
        {
          "name": "marketplace",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  109,
                  97,
                  114,
                  107,
                  101,
                  116,
                  112,
                  108,
                  97,
                  99,
                  101
                ]
              }
            ]
          }
        }
      ],
      "args": [
        {
          "name": "newAuthority",
          "type": "pubkey"
        }
      ]
    },
    {
      "name": "updateBuyerFee",
      "discriminator": [
        94,
        177,
        87,
        223,
        151,
        1,
        247,
        192
      ],
      "accounts": [
        {
          "name": "authority",
          "signer": true,
          "relations": [
            "marketplace"
          ]
        },
        {
          "name": "marketplace",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  109,
                  97,
                  114,
                  107,
                  101,
                  116,
                  112,
                  108,
                  97,
                  99,
                  101
                ]
              }
            ]
          }
        }
      ],
      "args": [
        {
          "name": "buyerFeeBps",
          "type": "u16"
        }
      ]
    },
    {
      "name": "updateDefaultSellerFee",
      "discriminator": [
        134,
        253,
        137,
        111,
        33,
        251,
        255,
        231
      ],
      "accounts": [
        {
          "name": "authority",
          "signer": true,
          "relations": [
            "marketplace"
          ]
        },
        {
          "name": "marketplace",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  109,
                  97,
                  114,
                  107,
                  101,
                  116,
                  112,
                  108,
                  97,
                  99,
                  101
                ]
              }
            ]
          }
        }
      ],
      "args": [
        {
          "name": "defaultSellerFeeBps",
          "type": "u16"
        }
      ]
    },
    {
      "name": "updateTreasury",
      "discriminator": [
        60,
        16,
        243,
        66,
        96,
        59,
        254,
        131
      ],
      "accounts": [
        {
          "name": "authority",
          "signer": true,
          "relations": [
            "marketplace"
          ]
        },
        {
          "name": "marketplace",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  109,
                  97,
                  114,
                  107,
                  101,
                  116,
                  112,
                  108,
                  97,
                  99,
                  101
                ]
              }
            ]
          }
        }
      ],
      "args": [
        {
          "name": "newTreasury",
          "type": "pubkey"
        }
      ]
    },
    {
      "name": "upsertSellerGroup",
      "discriminator": [
        124,
        18,
        73,
        183,
        32,
        156,
        148,
        86
      ],
      "accounts": [
        {
          "name": "authority",
          "writable": true,
          "signer": true,
          "relations": [
            "marketplace"
          ]
        },
        {
          "name": "marketplace",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  109,
                  97,
                  114,
                  107,
                  101,
                  116,
                  112,
                  108,
                  97,
                  99,
                  101
                ]
              }
            ]
          }
        },
        {
          "name": "group",
          "writable": true
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": [
        {
          "name": "groupId",
          "type": "u8"
        },
        {
          "name": "feeBps",
          "type": "u16"
        },
        {
          "name": "label",
          "type": {
            "array": [
              "u8",
              32
            ]
          }
        }
      ]
    }
  ],
  "accounts": [
    {
      "name": "buyerWaiver",
      "discriminator": [
        132,
        155,
        241,
        215,
        13,
        155,
        109,
        218
      ]
    },
    {
      "name": "cryptoSellerAllowance",
      "discriminator": [
        255,
        163,
        134,
        161,
        173,
        103,
        2,
        187
      ]
    },
    {
      "name": "invoice",
      "discriminator": [
        51,
        194,
        250,
        114,
        6,
        104,
        18,
        164
      ]
    },
    {
      "name": "marketplace",
      "discriminator": [
        70,
        222,
        41,
        62,
        78,
        3,
        32,
        174
      ]
    },
    {
      "name": "sellerGroup",
      "discriminator": [
        202,
        87,
        155,
        161,
        7,
        162,
        35,
        190
      ]
    },
    {
      "name": "sellerProfile",
      "discriminator": [
        96,
        227,
        91,
        129,
        3,
        158,
        255,
        21
      ]
    }
  ],
  "events": [
    {
      "name": "invoicePaid",
      "discriminator": [
        200,
        211,
        168,
        170,
        46,
        82,
        83,
        186
      ]
    }
  ],
  "errors": [
    {
      "code": 6000,
      "name": "feeTooHigh",
      "msg": "Fee basis points exceed the maximum allowed (max 10_000 = 100%)."
    },
    {
      "code": 6001,
      "name": "combinedFeeTooHigh",
      "msg": "Combined buyer + seller fees exceed the safety cap (50%)."
    },
    {
      "code": 6002,
      "name": "invalidPrice",
      "msg": "Payment amount must be greater than zero."
    },
    {
      "code": 6003,
      "name": "paused",
      "msg": "Marketplace is currently paused."
    },
    {
      "code": 6004,
      "name": "unauthorizedAuthority",
      "msg": "Signer is not the marketplace authority."
    },
    {
      "code": 6005,
      "name": "unauthorizedSeller",
      "msg": "Signer is not the listed seller."
    },
    {
      "code": 6006,
      "name": "treasuryMismatch",
      "msg": "Provided treasury token account does not match the marketplace config."
    },
    {
      "code": 6007,
      "name": "paymentMintMismatch",
      "msg": "Provided payment mint does not match the marketplace config (USDC only)."
    },
    {
      "code": 6008,
      "name": "mathOverflow",
      "msg": "Arithmetic overflow."
    },
    {
      "code": 6009,
      "name": "sellerGroupMismatch",
      "msg": "Provided seller_group account does not match the seller's profile / default."
    },
    {
      "code": 6010,
      "name": "sellerProfileMismatch",
      "msg": "Provided seller_profile account does not match the listing seller."
    },
    {
      "code": 6011,
      "name": "invalidBuyerWaiver",
      "msg": "Buyer waiver account does not belong to this program."
    },
    {
      "code": 6012,
      "name": "cannotMutateDefaultGroup",
      "msg": "Cannot delete or reassign the default seller group (id 0)."
    },
    {
      "code": 6013,
      "name": "invalidCryptoSellerAllowance",
      "msg": "Crypto seller allowance account does not belong to this program."
    },
    {
      "code": 6014,
      "name": "cryptoSellerNotAllowed",
      "msg": "Seller is not authorised to receive crypto payments."
    }
  ],
  "types": [
    {
      "name": "buyerWaiver",
      "docs": [
        "Existence-only PDA. If [BUYER_WAIVER_SEED, buyer_pubkey] is owned by",
        "this program and non-empty, the buyer fee is waived for that buyer.",
        "Created and closed exclusively by the marketplace authority — the seed",
        "derivation makes spoofing impossible."
      ],
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "buyer",
            "type": "pubkey"
          },
          {
            "name": "grantedAt",
            "type": "i64"
          },
          {
            "name": "bump",
            "type": "u8"
          },
          {
            "name": "reserved",
            "type": {
              "array": [
                "u8",
                32
              ]
            }
          }
        ]
      }
    },
    {
      "name": "cryptoSellerAllowance",
      "docs": [
        "Existence-only PDA. If [CRYPTO_SELLER_SEED, seller_pubkey] is owned by",
        "this program and non-empty, that seller is allowed to receive funds",
        "via `pay_invoice`. Created and closed exclusively by the marketplace",
        "authority. The marketplace `authority` itself never needs an allowance",
        "— it is implicitly allowed."
      ],
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "seller",
            "type": "pubkey"
          },
          {
            "name": "grantedAt",
            "type": "i64"
          },
          {
            "name": "bump",
            "type": "u8"
          },
          {
            "name": "reserved",
            "type": {
              "array": [
                "u8",
                32
              ]
            }
          }
        ]
      }
    },
    {
      "name": "initializeMarketplaceParams",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "buyerFeeBps",
            "docs": [
              "Buyer fee in bps (e.g. 50 = 0.5 %)."
            ],
            "type": "u16"
          },
          {
            "name": "defaultSellerFeeBps",
            "docs": [
              "Default seller fee in bps (e.g. 400 = 4 %). Also written into the",
              "default `SellerGroup` (id 0) created in this same instruction."
            ],
            "type": "u16"
          }
        ]
      }
    },
    {
      "name": "invoice",
      "docs": [
        "Existence-only PDA acting as a single-use receipt for `pay_invoice`.",
        "Seeded by [INVOICE_SEED, invoice_id (16 bytes)]. Anchor's `init`",
        "constraint guarantees a given `invoice_id` can only be paid once —",
        "any replay attempt fails with an account-already-in-use error."
      ],
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "invoiceId",
            "type": {
              "array": [
                "u8",
                16
              ]
            }
          },
          {
            "name": "buyer",
            "type": "pubkey"
          },
          {
            "name": "seller",
            "type": "pubkey"
          },
          {
            "name": "amount",
            "type": "u64"
          },
          {
            "name": "paidAt",
            "type": "i64"
          },
          {
            "name": "bump",
            "type": "u8"
          },
          {
            "name": "reserved",
            "type": {
              "array": [
                "u8",
                16
              ]
            }
          }
        ]
      }
    },
    {
      "name": "invoicePaid",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "invoiceId",
            "type": {
              "array": [
                "u8",
                16
              ]
            }
          },
          {
            "name": "buyer",
            "type": "pubkey"
          },
          {
            "name": "seller",
            "type": "pubkey"
          },
          {
            "name": "amount",
            "type": "u64"
          },
          {
            "name": "shipping",
            "type": "u64"
          },
          {
            "name": "buyerFee",
            "type": "u64"
          },
          {
            "name": "sellerFee",
            "type": "u64"
          },
          {
            "name": "sellerGroupId",
            "type": "u8"
          },
          {
            "name": "sellerFeeOverridden",
            "type": "bool"
          },
          {
            "name": "buyerWaived",
            "type": "bool"
          },
          {
            "name": "sellerIsAuthority",
            "type": "bool"
          }
        ]
      }
    },
    {
      "name": "marketplace",
      "docs": [
        "Global marketplace configuration (singleton PDA)."
      ],
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "authority",
            "docs": [
              "Authority allowed to update fees, treasury, manage groups & waivers."
            ],
            "type": "pubkey"
          },
          {
            "name": "paymentMint",
            "docs": [
              "USDC mint — set once at init and immutable thereafter."
            ],
            "type": "pubkey"
          },
          {
            "name": "treasury",
            "docs": [
              "Token account that receives all fees and primary-sale proceeds."
            ],
            "type": "pubkey"
          },
          {
            "name": "buyerFeeBps",
            "docs": [
              "Buyer fee (bps) charged ON TOP of every purchase, unless the buyer",
              "holds a `BuyerWaiver` PDA."
            ],
            "type": "u16"
          },
          {
            "name": "defaultSellerFeeBps",
            "docs": [
              "Seller fee (bps) used for any seller without an explicit",
              "`SellerProfile`. Mirrored on `SellerGroup { id = DEFAULT_SELLER_GROUP_ID }`",
              "at marketplace init time."
            ],
            "type": "u16"
          },
          {
            "name": "paused",
            "docs": [
              "Emergency switch — when true, listing and buying are blocked."
            ],
            "type": "bool"
          },
          {
            "name": "bump",
            "docs": [
              "Bump for the marketplace PDA."
            ],
            "type": "u8"
          },
          {
            "name": "reservedA",
            "docs": [
              "Reserved for forward-compatible upgrades. Split into two halves",
              "because `#[derive(Default)]` only auto-derives for arrays of length",
              "`<= 32`."
            ],
            "type": {
              "array": [
                "u8",
                32
              ]
            }
          },
          {
            "name": "reservedB",
            "type": {
              "array": [
                "u8",
                32
              ]
            }
          }
        ]
      }
    },
    {
      "name": "sellerGroup",
      "docs": [
        "One PDA per seller-fee tier. Seeded by [SELLER_GROUP_SEED, [group_id]].",
        "Created and updated by the marketplace authority."
      ],
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "groupId",
            "type": "u8"
          },
          {
            "name": "feeBps",
            "type": "u16"
          },
          {
            "name": "label",
            "docs": [
              "UTF-8, null-padded human label (e.g. \"default\", \"vip\")."
            ],
            "type": {
              "array": [
                "u8",
                32
              ]
            }
          },
          {
            "name": "bump",
            "type": "u8"
          },
          {
            "name": "reserved",
            "type": {
              "array": [
                "u8",
                32
              ]
            }
          }
        ]
      }
    },
    {
      "name": "sellerProfile",
      "docs": [
        "One PDA per seller wallet. Seeded by [SELLER_PROFILE_SEED, seller].",
        "If no profile exists for a seller, they are treated as",
        "`group_id = DEFAULT_SELLER_GROUP_ID`. Only the marketplace authority",
        "can create/move profiles."
      ],
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "seller",
            "type": "pubkey"
          },
          {
            "name": "groupId",
            "type": "u8"
          },
          {
            "name": "bump",
            "type": "u8"
          },
          {
            "name": "overrideFeeBps",
            "docs": [
              "Optional per-seller fee override (bps). When `Some(x)`, this fee is",
              "used INSTEAD OF the seller_group's `fee_bps` for the seller's",
              "share at sale time. Used by the admin UI to grant individualised",
              "fees without minting a new SellerGroup per user."
            ],
            "type": {
              "option": "u16"
            }
          },
          {
            "name": "reserved",
            "docs": [
              "Reduced from 32 to 29 bytes to make room for the optional override",
              "(1 + 2 bytes serialised by Anchor)."
            ],
            "type": {
              "array": [
                "u8",
                29
              ]
            }
          }
        ]
      }
    }
  ]
};
