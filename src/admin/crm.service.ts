import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { CrmContact } from './entities/crm-contact.entity';
import { CrmNote } from './entities/crm-note.entity';
import { DiscoveredLead } from './entities/discovered-lead.entity';

export interface CreateContactInput {
  kind: 'buyer' | 'seller';
  name: string;
  handle?: string | null;
  email?: string | null;
  company?: string | null;
  location?: string | null;
  stage?: string;
  preferred?: boolean;
  tags?: string[] | null;
  interests?: string[] | null;
  source?: string;
  leadId?: string | null;
}

const CONTACT_STAGES = ['new', 'contacted', 'negotiating', 'active', 'archived'];
const normStage = (s?: string | null) =>
  s && CONTACT_STAGES.includes(s) ? s : 'new';
const cleanList = (v?: string[] | null): string[] | null =>
  Array.isArray(v)
    ? v.map(x => String(x).trim()).filter(Boolean).slice(0, 40)
    : null;

/**
 * The CRM manual layer: buyer/seller contacts, their note timelines, and
 * converting an auto-discovered lead into a tracked contact.
 */
@Injectable()
export class CrmService {
  constructor(
    @InjectRepository(CrmContact)
    private readonly contacts: Repository<CrmContact>,
    @InjectRepository(CrmNote)
    private readonly notes: Repository<CrmNote>,
    @InjectRepository(DiscoveredLead)
    private readonly leads: Repository<DiscoveredLead>,
  ) {}

  async listContacts(opts: {
    kind?: string;
    search?: string;
    preferred?: boolean;
    stage?: string;
  }): Promise<CrmContact[]> {
    const qb = this.contacts.createQueryBuilder('c');
    if (opts.kind === 'buyer' || opts.kind === 'seller')
      qb.andWhere('c.kind = :kind', { kind: opts.kind });
    if (opts.stage && CONTACT_STAGES.includes(opts.stage))
      qb.andWhere('c.stage = :stage', { stage: opts.stage });
    if (opts.preferred) qb.andWhere('c.preferred = true');
    if (opts.search && opts.search.trim()) {
      qb.andWhere(
        '(c.name ILIKE :q OR c.handle ILIKE :q OR c.email ILIKE :q OR c.company ILIKE :q)',
        { q: `%${opts.search.trim()}%` },
      );
    }
    // Preferred first, then most recently touched.
    qb.orderBy('c.preferred', 'DESC').addOrderBy('c.updatedAt', 'DESC').take(500);
    return qb.getMany();
  }

  async createContact(
    input: CreateContactInput,
    adminId: string | null,
  ): Promise<CrmContact> {
    const kind = input.kind === 'seller' ? 'seller' : 'buyer';
    const contact = this.contacts.create({
      kind,
      name: (input.name || '').trim().slice(0, 200) || 'Unnamed',
      handle: input.handle?.trim() || null,
      email: input.email?.trim() || null,
      company: input.company?.trim() || null,
      location: input.location?.trim() || null,
      source: input.source?.trim() || 'manual',
      stage: normStage(input.stage),
      preferred: !!input.preferred,
      tags: cleanList(input.tags),
      interests: cleanList(input.interests),
      leadId: input.leadId || null,
      createdById: adminId,
    });
    return this.contacts.save(contact);
  }

  async updateContact(
    id: string,
    patch: Partial<CreateContactInput>,
  ): Promise<CrmContact> {
    const contact = await this.contacts.findOne({ where: { id } });
    if (!contact) throw new NotFoundException('Contact not found');
    if (patch.name !== undefined)
      contact.name = (patch.name || '').trim().slice(0, 200) || contact.name;
    if (patch.handle !== undefined) contact.handle = patch.handle?.trim() || null;
    if (patch.email !== undefined) contact.email = patch.email?.trim() || null;
    if (patch.company !== undefined)
      contact.company = patch.company?.trim() || null;
    if (patch.location !== undefined)
      contact.location = patch.location?.trim() || null;
    if (patch.stage !== undefined) contact.stage = normStage(patch.stage);
    if (patch.preferred !== undefined) contact.preferred = !!patch.preferred;
    if (patch.tags !== undefined) contact.tags = cleanList(patch.tags);
    if (patch.interests !== undefined)
      contact.interests = cleanList(patch.interests);
    return this.contacts.save(contact);
  }

  async deleteContact(id: string): Promise<{ id: string }> {
    await this.notes.delete({ contactId: id });
    await this.contacts.delete({ id });
    return { id };
  }

  async listNotes(opts: {
    contactId?: string;
    leadId?: string;
  }): Promise<CrmNote[]> {
    const where = opts.contactId
      ? { contactId: opts.contactId }
      : opts.leadId
        ? { leadId: opts.leadId }
        : null;
    if (!where) return [];
    return this.notes.find({ where, order: { createdAt: 'DESC' }, take: 200 });
  }

  async addNote(
    input: { contactId?: string; leadId?: string; body: string },
    adminId: string | null,
  ): Promise<CrmNote> {
    const note = this.notes.create({
      contactId: input.contactId || null,
      leadId: input.leadId || null,
      body: (input.body || '').trim().slice(0, 4000),
      authorId: adminId,
    });
    const saved = await this.notes.save(note);
    // Touch the contact so it re-sorts to the top of the list.
    if (input.contactId)
      await this.contacts.update({ id: input.contactId }, { updatedAt: new Date() });
    return saved;
  }

  async deleteNote(id: string): Promise<{ id: string }> {
    await this.notes.delete({ id });
    return { id };
  }

  /** Convert a discovered lead into a tracked contact (buyer by default). */
  async convertLead(
    leadId: string,
    kind: 'buyer' | 'seller',
    adminId: string | null,
  ): Promise<CrmContact> {
    const lead = await this.leads.findOne({ where: { id: leadId } });
    if (!lead) throw new NotFoundException('Lead not found');

    // Avoid duplicate conversions of the same lead.
    const existing = await this.contacts.findOne({ where: { leadId } });
    if (existing) return existing;

    const contact = await this.createContact(
      {
        kind,
        name: lead.authorDisplay || lead.author || 'Unnamed',
        handle: lead.author || null,
        location: lead.community || null,
        interests: lead.interests || null,
        source: lead.source,
        leadId: lead.id,
      },
      adminId,
    );

    lead.status = 'added';
    await this.leads.save(lead);

    if (lead.text || lead.url) {
      await this.addNote(
        {
          contactId: contact.id,
          body: `Converted from ${lead.source} lead.${lead.url ? ` ${lead.url}` : ''}${lead.text ? `\n\n"${lead.text.slice(0, 500)}"` : ''}`,
        },
        adminId,
      );
    }
    return contact;
  }

  /**
   * Bulk-import contacts from a mapped spreadsheet (Excel/CSV upload or Google
   * Sheet). Rows are already normalized client-side. De-duplicates within the
   * kind by email → handle → name so re-importing the same list is idempotent.
   */
  async importContacts(
    kind: 'buyer' | 'seller',
    incoming: CreateContactInput[],
    adminId: string | null,
  ): Promise<{ created: number; skipped: number; total: number }> {
    const rows = (Array.isArray(incoming) ? incoming : []).slice(0, 5000);
    const keyOf = (
      email?: string | null,
      handle?: string | null,
      name?: string | null,
    ): string => {
      const e = (email || '').trim().toLowerCase();
      if (e) return 'e:' + e;
      const h = (handle || '').trim().toLowerCase().replace(/^@/, '');
      if (h) return 'h:' + h;
      return 'n:' + (name || '').trim().toLowerCase();
    };

    const existing = await this.contacts.find({
      where: { kind },
      select: ['email', 'handle', 'name'],
    });
    const seen = new Set(existing.map(c => keyOf(c.email, c.handle, c.name)));

    const toCreate: CrmContact[] = [];
    let skipped = 0;
    for (const r of rows) {
      const name = (r.name || '').trim();
      if (!name) {
        skipped++;
        continue;
      }
      const key = keyOf(r.email, r.handle, name);
      if (seen.has(key)) {
        skipped++;
        continue;
      }
      seen.add(key);
      toCreate.push(
        this.contacts.create({
          kind,
          name: name.slice(0, 200),
          handle: r.handle?.trim() || null,
          email: r.email?.trim() || null,
          company: r.company?.trim() || null,
          location: r.location?.trim() || null,
          source: r.source?.trim() || 'import',
          stage: normStage(r.stage),
          preferred: !!r.preferred,
          tags: cleanList(r.tags),
          interests: cleanList(r.interests),
          leadId: null,
          createdById: adminId,
        }),
      );
    }
    if (toCreate.length) await this.contacts.save(toCreate, { chunk: 200 });
    return { created: toCreate.length, skipped, total: rows.length };
  }

  async stats(): Promise<{
    buyers: number;
    sellers: number;
    preferred: number;
    total: number;
  }> {
    const [buyers, sellers, preferred, total] = await Promise.all([
      this.contacts.count({ where: { kind: 'buyer' } }),
      this.contacts.count({ where: { kind: 'seller' } }),
      this.contacts.count({ where: { preferred: true } }),
      this.contacts.count(),
    ]);
    return { buyers, sellers, preferred, total };
  }
}
