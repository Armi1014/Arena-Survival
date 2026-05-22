/**
 * @typedef {Object} PlayerState
 * @property {number} x
 * @property {number} y
 * @property {number} radius
 * @property {number} hp
 * @property {number} maxHp
 * @property {number} moveSpeed
 * @property {number} fireCooldown
 * @property {number} fireCooldownRemaining
 * @property {number} projectileSpeed
 * @property {number} projectileRadius
 * @property {number} projectileDamage
 * @property {number} projectileLifetime
 * @property {string} characterId
 * @property {"ranged" | "melee"} attackType
 * @property {number} pierce
 * @property {number} multishot
 * @property {number} spreadAngle
 * @property {number} dashSpeed
 * @property {number} dashDuration
 * @property {number} dashTimeRemaining
 * @property {number} dashCooldown
 * @property {number} dashCooldownRemaining
 * @property {number} dashInvulnerability
 * @property {number} invulnerabilityRemaining
 * @property {{x: number, y: number}} dashVector
 * @property {number} magnetRadius
 * @property {number} shields
 * @property {number} maxShields
 * @property {number} shieldRegenSeconds
 * @property {number} shieldRegenTimer
 * @property {number} xpMultiplier
 * @property {number} grenadeCooldown
 * @property {number} grenadeCooldownRemaining
 * @property {number} grenadeDamage
 * @property {number} grenadeRadius
 * @property {number} grenadeProjectileSpeed
 * @property {number} grenadeFuse
 * @property {boolean} grenadeEquipped
 * @property {number} slashDamage
 * @property {number} slashRange
 * @property {number} slashArc
 * @property {number} slashMaxTargets
 * @property {number} bleedDamagePerSecond
 * @property {number} bleedDuration
 * @property {number} counterInvulnerability
 * @property {number} dashSlashDamage
 */

/**
 * @typedef {Object} CharacterDef
 * @property {string} id
 * @property {string} name
 * @property {string} description
 * @property {"ranged" | "melee"} attackType
 * @property {boolean} [unlockedByDefault]
 * @property {number} [unlockBossKills]
 * @property {string} color
 * @property {string} accent
 * @property {{damage: number, range: number, arc: number, cooldown: number, maxTargets: number, bleedDamagePerSecond: number, bleedDuration: number, counterInvulnerability: number, dashSlashDamage: number}} [slash]
 */

/**
 * @typedef {Object} EnemyDef
 * @property {string} id
 * @property {string} name
 * @property {number} cost
 * @property {number} radius
 * @property {number} maxHp
 * @property {number} speed
 * @property {number} contactDamage
 * @property {number} xpValue
 * @property {number} scoreValue
 * @property {string} color
 * @property {string} accent
 * @property {"nibbler" | "spitter" | "bumper"} behavior
 */

/**
 * @typedef {Object} BossDef
 * @property {string} id
 * @property {string} name
 * @property {number} radius
 * @property {number} maxHp
 * @property {number} speed
 * @property {number} contactDamage
 * @property {number} xpValue
 * @property {number} scoreValue
 * @property {string} color
 * @property {string} accent
 */

/**
 * @typedef {Object} UpgradeDef
 * @property {string} id
 * @property {string} name
 * @property {number} cap
 * @property {string} color
 * @property {string} accent
 * @property {string[]} [characters]
 * @property {string[]} [excludeCharacters]
 * @property {(player: PlayerState) => boolean} [isAvailable]
 * @property {(nextRank: number) => string} describe
 * @property {(player: PlayerState, nextRank: number) => void} apply
 */

/**
 * @typedef {Object} RunStats
 * @property {number} elapsed
 * @property {number} level
 * @property {number} xp
 * @property {number} xpToNext
 * @property {number} kills
 * @property {number} bossKills
 * @property {number} shotsFired
 * @property {number} killScore
 * @property {number} score
 * @property {number} damageTaken
 * @property {Record<string, number>} enemyKills
 * @property {Record<string, number>} enemyDeaths
 * @property {boolean} recorded
 */

export {};
