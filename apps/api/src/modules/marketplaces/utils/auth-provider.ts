/**
 * Authentication Providers
 *
 * Supports multiple authentication methods discovered across marketplaces:
 * - Basic Auth (Fruugo, Sportdeal)
 * - Token Header (Shopify, OnBuy)
 * - Token Body (BaseLinker)
 * - OAuth 2.0 Client Credentials (Walmart, OnBuy)
 */

import { AuthenticationError } from './errors';
import type { AuthConfig } from '../config/types';

/**
 * Interface for authentication providers.
 * Each provider knows how to add auth to requests.
 */
export interface AuthProvider {
  /**
   * Get headers to add to the request.
   * For Basic Auth and Token Header auth.
   */
  getHeaders(): Promise<Record<string, string>>;

  /**
   * Get body parameters to add to the request.
   * For Token Body auth (e.g., BaseLinker).
   */
  getBodyParams(): Promise<Record<string, string>>;
}

/**
 * No authentication - for public endpoints.
 */
export class NoAuthProvider implements AuthProvider {
  async getHeaders(): Promise<Record<string, string>> {
    return {};
  }

  async getBodyParams(): Promise<Record<string, string>> {
    return {};
  }
}

/**
 * Basic Authentication - username:password encoded as base64.
 * Used by: Fruugo, Sportdeal
 */
export class BasicAuthProvider implements AuthProvider {
  private readonly encodedCredentials: string;

  constructor(username: string, password: string) {
    if (!username || !password) {
      throw new AuthenticationError('Username and password are required for Basic Auth');
    }
    this.encodedCredentials = Buffer.from(`${username}:${password}`).toString('base64');
  }

  async getHeaders(): Promise<Record<string, string>> {
    return {
      Authorization: `Basic ${this.encodedCredentials}`,
    };
  }

  async getBodyParams(): Promise<Record<string, string>> {
    return {};
  }
}

/**
 * Token Header Authentication - token sent in Authorization header.
 * Used by: Shopify, OnBuy
 */
export class TokenHeaderAuthProvider implements AuthProvider {
  private readonly token: string;
  private readonly prefix: string;

  constructor(token: string, prefix: string = 'Bearer') {
    if (!token) {
      throw new AuthenticationError('Token is required for Token Header Auth');
    }
    this.token = token;
    this.prefix = prefix;
  }

  async getHeaders(): Promise<Record<string, string>> {
    return {
      Authorization: `${this.prefix} ${this.token}`,
    };
  }

  async getBodyParams(): Promise<Record<string, string>> {
    return {};
  }
}

/**
 * Token Body Authentication - token sent as request body parameter.
 * Used by: BaseLinker
 */
export class TokenBodyAuthProvider implements AuthProvider {
  private readonly token: string;
  private readonly paramName: string;

  constructor(token: string, paramName: string = 'token') {
    if (!token) {
      throw new AuthenticationError('Token is required for Token Body Auth');
    }
    this.token = token;
    this.paramName = paramName;
  }

  async getHeaders(): Promise<Record<string, string>> {
    return {};
  }

  async getBodyParams(): Promise<Record<string, string>> {
    return {
      [this.paramName]: this.token,
    };
  }
}

/**
 * OAuth 2.0 configuration.
 */
export interface OAuth2Config {
  clientId: string;
  clientSecret: string;
  tokenUrl: string;
  scope?: string;
}

/**
 * OAuth 2.0 token response.
 */
interface TokenResponse {
  access_token: string;
  token_type?: string;
  expires_in?: number;
  refresh_token?: string;
  scope?: string;
}

/**
 * OAuth 2.0 Client Credentials Authentication.
 * Automatically fetches and caches access tokens.
 * Used by: Walmart, OnBuy
 */
export class OAuth2Provider implements AuthProvider {
  private readonly config: OAuth2Config;
  private accessToken?: string;
  private expiresAt?: number;

  /** Buffer time before expiry to refresh token (60 seconds) */
  private readonly expiryBuffer = 60000;

  constructor(config: OAuth2Config) {
    if (!config.clientId || !config.clientSecret || !config.tokenUrl) {
      throw new AuthenticationError(
        'clientId, clientSecret, and tokenUrl are required for OAuth2'
      );
    }
    this.config = config;
  }

  async getHeaders(): Promise<Record<string, string>> {
    const token = await this.getAccessToken();
    return {
      Authorization: `Bearer ${token}`,
    };
  }

  async getBodyParams(): Promise<Record<string, string>> {
    return {};
  }

  /**
   * Get a valid access token, refreshing if necessary.
   */
  private async getAccessToken(): Promise<string> {
    // Return cached token if still valid (with buffer time)
    if (this.accessToken && this.expiresAt && Date.now() < this.expiresAt - this.expiryBuffer) {
      return this.accessToken;
    }

    // Fetch new token
    const response = await this.fetchToken();
    this.accessToken = response.access_token;

    // Calculate expiry time (default to 1 hour if not provided)
    const expiresIn = response.expires_in || 3600;
    this.expiresAt = Date.now() + expiresIn * 1000;

    return this.accessToken;
  }

  /**
   * Fetch a new access token from the token endpoint.
   */
  private async fetchToken(): Promise<TokenResponse> {
    const body = new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: this.config.clientId,
      client_secret: this.config.clientSecret,
    });

    if (this.config.scope) {
      body.append('scope', this.config.scope);
    }

    try {
      const response = await fetch(this.config.tokenUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: body.toString(),
      });

      if (!response.ok) {
        const errorBody = await response.text();
        throw new AuthenticationError(
          `OAuth2 token request failed: ${response.status} ${response.statusText} - ${errorBody}`
        );
      }

      const data = (await response.json()) as TokenResponse;

      if (!data.access_token) {
        throw new AuthenticationError('OAuth2 response missing access_token');
      }

      return data;
    } catch (error) {
      if (error instanceof AuthenticationError) {
        throw error;
      }
      throw new AuthenticationError(
        `Failed to fetch OAuth2 token: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  /**
   * Force refresh the token (useful for handling 401 responses).
   */
  async refreshToken(): Promise<void> {
    this.accessToken = undefined;
    this.expiresAt = undefined;
    await this.getAccessToken();
  }
}

/**
 * Factory for creating auth providers from config.
 */
export class AuthProviderFactory {
  /**
   * Create an auth provider based on configuration.
   */
  static create(config?: AuthConfig): AuthProvider {
    if (!config || config.type === 'none') {
      return new NoAuthProvider();
    }

    switch (config.type) {
      case 'basic':
        if (!config.username || !config.password) {
          throw new AuthenticationError('Username and password required for Basic Auth');
        }
        return new BasicAuthProvider(config.username, config.password);

      case 'token-header':
        if (!config.token) {
          throw new AuthenticationError('Token required for Token Header Auth');
        }
        return new TokenHeaderAuthProvider(config.token, config.tokenPrefix);

      case 'token-body':
        if (!config.token) {
          throw new AuthenticationError('Token required for Token Body Auth');
        }
        return new TokenBodyAuthProvider(config.token, config.tokenParam);

      case 'oauth2':
        if (!config.clientId || !config.clientSecret || !config.tokenUrl) {
          throw new AuthenticationError(
            'clientId, clientSecret, and tokenUrl required for OAuth2'
          );
        }
        return new OAuth2Provider({
          clientId: config.clientId,
          clientSecret: config.clientSecret,
          tokenUrl: config.tokenUrl,
          scope: config.scope,
        });

      default:
        throw new AuthenticationError(`Unknown auth type: ${config.type}`);
    }
  }
}
