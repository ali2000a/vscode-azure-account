/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// eslint-disable-next-line import/no-extraneous-dependencies
import * as keytarType from 'keytar';
import { getNodeModule } from './getNodeModule';

export type KeyTar = typeof keytarType;

export function tryGetKeyTar(): KeyTar | undefined {
    return getNodeModule('keytar');
}
