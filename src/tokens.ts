/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { SubscriptionClient, SubscriptionModels } from "@azure/arm-subscriptions";
import { Environment } from "@azure/ms-rest-azure-env";
import { DeviceTokenCredentials as DeviceTokenCredentials2 } from '@azure/ms-rest-nodeauth';
import { AuthenticationContext, MemoryCache, TokenResponse } from "adal-node";
import { clientId, credentialsSection } from "./constants";
import { AzureLoginError } from "./errors";
import { listAll } from "./utils/arrayUtils";
import { tryGetKeyTar } from "./utils/keytar";
import { localize } from "./utils/localize";

// eslint-disable-next-line @typescript-eslint/no-var-requires, @typescript-eslint/no-unsafe-assignment
const CacheDriver = require('adal-node/lib/cache-driver');
// eslint-disable-next-line @typescript-eslint/no-var-requires, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access
const createLogContext = require('adal-node/lib/log').createLogContext;

const keytar = tryGetKeyTar();

export interface Cache {
	subscriptions: {
		session: {
			environment: string;
			userId: string;
			tenantId: string;
		};
		subscription: SubscriptionModels.Subscription;
	}[];
}

export class ProxyTokenCache {
	/* eslint-disable */
	public initEnd?: () => void;
	private init = new Promise<void>(resolve => {
		this.initEnd = resolve;
	});

	constructor(private target: any) {
	}

	remove(entries: any, callback: any) {
		this.target.remove(entries, callback)
	}

	add(entries: any, callback: any) {
		this.target.add(entries, callback)
	}

	find(query: any, callback: any) {
		void this.init.then(() => {
			this.target.find(query, callback);
		});
	}
	/* eslint-enable */
}

// eslint-disable-next-line @typescript-eslint/explicit-module-boundary-types
export async function getStoredCredentials(environment: Environment, migrateToken?: boolean) {
	if (!keytar) {
		return;
	}
	try {
		if (migrateToken) {
			const token = await keytar.getPassword('VSCode Public Azure', 'Refresh Token');
			if (token) {
				if (!await keytar.getPassword(credentialsSection, 'Azure')) {
					await keytar.setPassword(credentialsSection, 'Azure', token);
				}
				await keytar.deletePassword('VSCode Public Azure', 'Refresh Token');
			}
		}
	} catch (err) {
		// ignore
	}
	try {
		return keytar.getPassword(credentialsSection, environment.name);
	} catch (err) {
		// ignore
	}
}

// eslint-disable-next-line @typescript-eslint/explicit-module-boundary-types
export async function storeRefreshToken(environment: Environment, token: string) {
	if (keytar) {
		try {
			await keytar.setPassword(credentialsSection, environment.name, token);
		} catch (err) {
			// ignore
		}
	}
}

// eslint-disable-next-line @typescript-eslint/explicit-module-boundary-types
export async function deleteRefreshToken(environmentName: string) {
	if (keytar) {
		try {
			await keytar.deletePassword(credentialsSection, environmentName);
		} catch (err) {
			// ignore
		}
	}
}

// eslint-disable-next-line @typescript-eslint/explicit-module-boundary-types
export async function tokenFromRefreshToken(environment: Environment, refreshToken: string, tenantId: string, resource?: string) {
	return new Promise<TokenResponse>((resolve, reject) => {
		const tokenCache = new MemoryCache();
		const context = new AuthenticationContext(`${environment.activeDirectoryEndpointUrl}${tenantId}`, environment.validateAuthority, tokenCache);
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		context.acquireTokenWithRefreshToken(refreshToken, clientId, <any>resource, (err, tokenResponse) => {
			if (err) {
				reject(new AzureLoginError(localize('azure-account.tokenFromRefreshTokenFailed', "Acquiring token with refresh token failed"), err));
			} else if (tokenResponse.error) {
				reject(new AzureLoginError(localize('azure-account.tokenFromRefreshTokenFailed', "Acquiring token with refresh token failed"), tokenResponse));
			} else {
				resolve(<TokenResponse>tokenResponse);
			}
		});
	});
}

// eslint-disable-next-line @typescript-eslint/explicit-module-boundary-types
export async function tokensFromToken(environment: Environment, firstTokenResponse: TokenResponse) {
	const tokenCache = new MemoryCache();
	await addTokenToCache(environment, tokenCache, firstTokenResponse);
	const credentials = new DeviceTokenCredentials2(clientId, undefined, firstTokenResponse.userId, undefined, environment, tokenCache);
	const client = new SubscriptionClient(credentials, { baseUri: environment.resourceManagerEndpointUrl });
	const tenants = await listAll(client.tenants, client.tenants.list());
	const responses = <TokenResponse[]>(await Promise.all<TokenResponse | null>(tenants.map((tenant) => {
		if (tenant.tenantId === firstTokenResponse.tenantId) {
			return firstTokenResponse;
		}
		// eslint-disable-next-line @typescript-eslint/no-non-null-assertion
		return tokenFromRefreshToken(environment, firstTokenResponse.refreshToken!, tenant.tenantId!)
			.catch(err => {
				console.error(err instanceof AzureLoginError && err.reason ? err.reason : err);
				return null;
			});
	}))).filter(r => r);
	if (!responses.some(response => response.tenantId === firstTokenResponse.tenantId)) {
		responses.unshift(firstTokenResponse);
	}
	return responses;
}

/* eslint-disable */
export async function addTokenToCache(environment: Environment, tokenCache: any, tokenResponse: TokenResponse) {
	return new Promise<void>((resolve, reject) => {
		const driver = new CacheDriver(
			{ _logContext: createLogContext('') },
			`${environment.activeDirectoryEndpointUrl}${tokenResponse.tenantId}`,
			environment.activeDirectoryResourceId,
			clientId,
			tokenCache,
			(entry: any, resource: any, callback: (err: any, response: any) => {}) => {
				callback(null, entry);
			}
		);
		driver.add(tokenResponse, function (err: any) {
			if (err) {
				reject(err);
			} else {
				resolve();
			}
		});
	});
}

export async function clearTokenCache(tokenCache: any) {
	await new Promise<void>((resolve, reject) => {
		tokenCache.find({}, (err: any, entries: any[]) => {
			if (err) {
				reject(err);
			} else {
				tokenCache.remove(entries, (err: any) => {
					if (err) {
						reject(err);
					} else {
						resolve();
					}
				});
			}
		});
	});
}
/* eslint-enable */
