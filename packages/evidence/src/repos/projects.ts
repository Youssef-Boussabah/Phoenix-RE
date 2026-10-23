import { Project, CreateProjectInput } from '@phoenix/contracts';
import { type Database } from '../db/database.js';
import { Repository, input, newId, now } from './shared.js';
export class Projects extends Repository<Project> {
  constructor(db: Database) {
    super(db, 'projects', Project, 'id name createdAt:created_at');
  }
  create(value: unknown): Project {
    const p = input(CreateProjectInput, value);
    return this.insert({ schemaVersion: 1, id: newId('prj'), name: p.name, createdAt: now() });
  }
}
