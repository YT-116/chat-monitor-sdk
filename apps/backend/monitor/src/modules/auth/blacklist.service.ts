import { Injectable, Logger } from '@nestjs/common'
import Redis from 'ioredis'

import { RedisService } from '../../fundamentals/redis'

@Injectable()
export class BlacklistService {
    private readonly logger = new Logger(BlacklistService.name)
    private readonly redis: Redis
    private readonly memoryStore = new Map<string, number>()

    constructor(private readonly redisService: RedisService) {
        this.redis = this.redisService.getClient()
    }

    async addTokenToBlacklist(jti: string, userId: number, ttl: number): Promise<void> {
        await this.setWithFallback(`blacklist:token:${jti}`, userId.toString(), ttl)
    }

    async addUserToBlacklist(userId: number, ttl: number): Promise<void> {
        await this.setWithFallback(`blacklist:user:${userId}`, Date.now().toString(), ttl)
    }

    async isTokenBlacklisted(jti: string): Promise<boolean> {
        return this.existsWithFallback(`blacklist:token:${jti}`)
    }

    async isUserBlacklisted(userId: number): Promise<boolean> {
        return this.existsWithFallback(`blacklist:user:${userId}`)
    }

    async removeUserBlacklist(userId: number): Promise<void> {
        await this.deleteWithFallback(`blacklist:user:${userId}`)
    }

    async clearAllBlacklists(): Promise<void> {
        await this.deletePatternWithFallback('blacklist:*', 'blacklist:')
    }

    async storeRefreshToken(userId: number, jti: string, ttl: number): Promise<void> {
        await this.setWithFallback(`refresh:${userId}:${jti}`, Date.now().toString(), ttl)
    }

    async isRefreshTokenValid(userId: number, jti: string): Promise<boolean> {
        return this.existsWithFallback(`refresh:${userId}:${jti}`)
    }

    async removeRefreshToken(userId: number, jti: string): Promise<void> {
        await this.deleteWithFallback(`refresh:${userId}:${jti}`)
    }

    async clearUserRefreshTokens(userId: number): Promise<void> {
        await this.deletePatternWithFallback(`refresh:${userId}:*`, `refresh:${userId}:`)
    }

    private async setWithFallback(key: string, value: string, ttl: number): Promise<void> {
        try {
            await this.redis.setex(key, ttl, value)
        } catch (error) {
            this.memoryStore.set(key, Date.now() + ttl * 1000)
            this.logger.warn(`Redis unavailable; using in-memory auth store for ${key}`)
        }
    }

    private async existsWithFallback(key: string): Promise<boolean> {
        try {
            return (await this.redis.exists(key)) === 1
        } catch (error) {
            const expiresAt = this.memoryStore.get(key)
            if (!expiresAt) return false
            if (expiresAt < Date.now()) {
                this.memoryStore.delete(key)
                return false
            }
            return true
        }
    }

    private async deleteWithFallback(key: string): Promise<void> {
        try {
            await this.redis.del(key)
        } catch (error) {
            this.memoryStore.delete(key)
        }
    }

    private async deletePatternWithFallback(pattern: string, memoryPrefix: string): Promise<void> {
        try {
            const keys = await this.redis.keys(pattern)
            if (keys.length > 0) {
                await this.redis.del(...keys)
            }
        } catch (error) {
            for (const key of this.memoryStore.keys()) {
                if (key.startsWith(memoryPrefix)) {
                    this.memoryStore.delete(key)
                }
            }
        }
    }
}
