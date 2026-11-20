import 'reflect-metadata';
import { DataSource } from 'typeorm';
import { loadCliConfig } from '../config/load-cli-config';
import { databaseOptions } from './database.options';

export default new DataSource(databaseOptions(loadCliConfig().database));
