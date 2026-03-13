import bcrypt from 'bcryptjs'
import jwt from 'jsonwebtoken'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import User from '../user.model.js'
import { loginUser, registerUser } from '../user.service.js'

vi.mock('../user.model', () => ({
  default: {
    findOne: vi.fn(),
    create: vi.fn(),
    findById: vi.fn(),
    findByIdAndUpdate: vi.fn(),
    countDocuments: vi.fn(),
    find: vi.fn(),
  },
}))
vi.mock('bcryptjs')
vi.mock('jsonwebtoken')

describe('UserService', () => {
  beforeEach(() => {
    vi.resetAllMocks()
  })

  describe('registerUser', () => {
    it('should register a new user successfully', async () => {
      const mockUser = {
        _id: '123',
        email: 'test@example.com',
        name: 'Test',
        surname: 'User',
        password: 'hashedpassword',
        toObject: () => ({
          _id: '123',
          email: 'test@example.com',
          name: 'Test',
          surname: 'User',
          password: 'hashedpassword',
        }),
      }

      vi.mocked(User.findOne).mockResolvedValue(null as never)

      vi.mocked(bcrypt.hash).mockResolvedValue('hashedpassword' as never)
      vi.mocked(User.create).mockResolvedValue(mockUser as never)

      const result = await registerUser({
        username: 'testuser',
        email: 'test@example.com',
        password: 'password123',
        name: 'Test',
        surname: 'User',
      })

      expect(User.findOne).toHaveBeenCalledWith({ email: 'test@example.com' })
      expect(bcrypt.hash).toHaveBeenCalledWith('password123', 10)
      expect(User.create).toHaveBeenCalled()
      expect(result).not.toHaveProperty('password')
      expect(result.email).toBe('test@example.com')
      expect(result.name).toBe('Test')
    })

    it('should throw error if email already exists', async () => {
      vi.mocked(User.findOne).mockResolvedValue({ _id: '123' } as never)

      await expect(
        registerUser({
          username: 'existinguser',
          email: 'existing@example.com',
          password: 'password123',
          name: 'Test',
          surname: 'User',
        }),
      ).rejects.toThrow('user.email_in_use')
    })
  })

  describe('loginUser', () => {
    it('should login successfully', async () => {
      const mockUser = {
        _id: '123',
        roles: ['user_role_id'],
        role: 'user',
        password: 'hashedpassword',
        email: 'test@example.com',
        deleted: false,
        toObject: () => ({
          _id: '123',
          email: 'test@example.com',
          roles: ['user_role_id'],
          role: 'user',
          password: 'hashedpassword',
        }),
      }

      const mockSelect = { select: vi.fn().mockResolvedValue(mockUser) }
      vi.mocked(User.findOne).mockReturnValue(mockSelect as never)

      vi.mocked(bcrypt.compare).mockResolvedValue(true as never)
      vi.mocked(jwt.sign).mockReturnValue('mock_token' as never)

      const result = await loginUser({ email: 'test@example.com', password: 'password123' })

      expect(result.token).toBe('mock_token')
      expect(result.user.email).toBe('test@example.com')
    })

    it('should throw if invalid credentials', async () => {
      const mockSelectNull = { select: vi.fn().mockResolvedValue(null) }
      vi.mocked(User.findOne).mockReturnValue(mockSelectNull as never)

      await expect(loginUser({ email: 'wrong@example.com', password: 'pw' })).rejects.toThrow(
        'auth.invalid_credentials',
      )

      const mockUser = {
        _id: '123',
        password: 'hashedpassword',
      }
      const mockSelect = { select: vi.fn().mockResolvedValue(mockUser) }
      vi.mocked(User.findOne).mockReturnValue(mockSelect as never)
      vi.mocked(bcrypt.compare).mockResolvedValue(false as never)

      await expect(
        loginUser({ email: 'test@example.com', password: 'wrongpassword' }),
      ).rejects.toThrow('auth.invalid_credentials')
    })
  })
})
