import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import type pg from 'pg';
import { isolatedDatabase } from './helpers/isolated-database.js';
import { VISION_RESPONSE, VISION_STYLES } from './fixtures/vision-v2.js';
import { parseImageAnalysisV2Response } from '../src/modules/image-analysis/image-analysis-v2.contract.js';

const migrationName = '20261002200000_remove_nita_v1';

describe.runIf(process.env.RUN_NITA_V2_DB_TESTS === '1')(
  'Nita cleanup migration in isolated PostgreSQL',
  { timeout: 30_000 },
  () => {
    let database: Awaited<ReturnType<typeof isolatedDatabase>>;
    const accountId = randomUUID(),
      customerId = randomUUID(),
      channelId = randomUUID();
    const oldConversationId = randomUUID(),
      currentConversationId = randomUUID();
    const oldLeadId = randomUUID(),
      orphanLeadId = randomUUID(),
      currentLeadId = randomUUID();
    const modelId = randomUUID(),
      quoteId = randomUUID(),
      currentImageId = randomUUID();
    const adminId = randomUUID(),
      ruleId = randomUUID();

    async function insert(client: pg.Client, table: string, values: Record<string, unknown>) {
      const entries = Object.entries(values);
      await client.query(
        `INSERT INTO "${table}" (${entries.map(([key]) => `"${key}"`).join(',')}) VALUES (${entries.map((_, i) => `$${i + 1}`).join(',')})`,
        entries.map(([, value]) => value),
      );
    }
    async function seedBeforeCleanup(client: pg.Client, conflictingQuote = false) {
      const updated_at = new Date();
      await insert(client, 'tattoo_artist_accounts', {
        id: accountId,
        name: 'Cleanup isolated account',
        updated_at,
      });
      await insert(client, 'users', {
        id: adminId,
        email: `${adminId}@test.invalid`,
        password_hash: 'test-only',
        role: 'ADMIN',
        updated_at,
      });
      await insert(client, 'whatsapp_channels', {
        id: channelId,
        account_id: accountId,
        phone_number: '51999000001',
        phone_number_id: '91999000001',
        updated_at,
      });
      await insert(client, 'customers', {
        id: customerId,
        account_id: accountId,
        phone_number: '51999000002',
        updated_at,
      });
      await insert(client, 'conversations', {
        id: oldConversationId,
        account_id: accountId,
        customer_id: customerId,
        flow_version: 'V1',
        current_state: 'ASK_SIZE',
        status: 'COMPLETED',
        updated_at,
      });
      await insert(client, 'conversations', {
        id: currentConversationId,
        account_id: accountId,
        customer_id: customerId,
        flow_version: 'V2',
        current_state: 'ASK_ADVANCE_INTENT',
        target_size_cm: 12,
        same_size_as_reference: true,
        updated_at,
      });
      await insert(client, 'pricing_rules', {
        id: ruleId,
        account_id: accountId,
        size: 'SMALL',
        detail: 'LIGHT',
        min_price: 100,
        max_price: 200,
        updated_at,
      });
      await insert(client, 'pricing_rule_history', {
        id: randomUUID(),
        pricing_rule_id: ruleId,
        changed_by_user_id: adminId,
        old_min_price: 90,
        old_max_price: 190,
        new_min_price: 100,
        new_max_price: 200,
      });
      await insert(client, 'leads', {
        id: oldLeadId,
        account_id: accountId,
        customer_id: customerId,
        conversation_id: oldConversationId,
        selected_size: 'SMALL',
        selected_detail: 'LIGHT',
        pricing_rule_id: ruleId,
        pricing_rule_version: 1,
        status: 'VERIFIED',
        updated_at,
      });
      await insert(client, 'leads', {
        id: orphanLeadId,
        account_id: accountId,
        customer_id: customerId,
        selected_size: 'SMALL',
        updated_at,
      });
      await insert(client, 'leads', {
        id: currentLeadId,
        account_id: accountId,
        customer_id: customerId,
        conversation_id: currentConversationId,
        target_size_cm: 12,
        same_size_as_reference: true,
        status: 'AUTO_QUOTED',
        updated_at,
      });
      await insert(client, 'lead_evaluations', {
        id: randomUUID(),
        lead_id: oldLeadId,
        raw_score: 100,
        max_positive_score: 100,
        readiness_score: 100,
        readiness_status: 'LISTO',
        rules_version: 1,
        contributions: [],
        blockers: [],
        updated_at,
      });
      await insert(client, 'ai_analyses', {
        id: randomUUID(),
        lead_id: oldLeadId,
        analysis_version: 'V1',
        detected_size: 'SMALL',
        size_confidence: 0.99,
        detected_detail: 'LIGHT',
        detail_confidence: 0.99,
      });
      const response: Record<string, unknown> = { ...VISION_RESPONSE };
      delete response.estimated_density;
      const observations = parseImageAnalysisV2Response(
        JSON.stringify(response),
        VISION_STYLES,
        'VISION_V2_4',
      );
      const fields = Object.fromEntries(
        Object.entries(observations).map(([key, value]) => [
          key.replace(/[A-Z]/g, (letter) => '_' + letter.toLowerCase()),
          value,
        ]),
      );
      await insert(client, 'ai_analyses', {
        id: randomUUID(),
        lead_id: currentLeadId,
        analysis_version: 'V2',
        ...fields,
        prompt_version: 4,
        schema_version: 'VISION_V2_4',
        provider: 'gemini',
        model: 'historical',
        raw_response: { outputText: JSON.stringify(response) },
      });
      const style = await client.query<{ id: string }>(
        "SELECT id FROM tattoo_styles WHERE code = 'FINE_LINE'",
      );
      await insert(client, 'pricing_model_versions', {
        id: modelId,
        account_id: accountId,
        style_id: style.rows[0].id,
        version: 1,
        status: 'ACTIVE',
        algorithm_version: 'AREA_COLOR_SEPARABLE_V1',
        case_snapshot: { retained: true },
        model_parameters: { retained: true },
      });
      await insert(client, 'quotes', {
        id: quoteId,
        lead_id: conflictingQuote ? oldLeadId : currentLeadId,
        account_id: accountId,
        pricing_model_version_id: modelId,
        amount: 500,
        target_area_cm2: 54,
        target_color_coverage: 0,
        detected_style: 'FINE_LINE',
        general_adjustment_percent: 0,
        algorithm_version: 'AREA_COLOR_SEPARABLE_V1',
        snapshot: { retained: true },
      });
      await insert(client, 'lead_images', {
        id: randomUUID(),
        lead_id: oldLeadId,
        storage_path: 'test/old.png',
      });
      await insert(client, 'lead_images', {
        id: currentImageId,
        lead_id: currentLeadId,
        storage_path: 'test/current.png',
      });
    }
    beforeAll(async () => {
      database = await isolatedDatabase(async (name, client) => {
        if (name === migrationName) await seedBeforeCleanup(client);
      });
    }, 120_000);
    afterAll(async () => {
      if (database) await database.close();
    }, 30_000);

    it('removes obsolete tables, columns, enums and exclusively old records', async () => {
      expect(
        await database.prisma.lead.findMany({ where: { id: { in: [oldLeadId, orphanLeadId] } } }),
      ).toEqual([]);
      expect(
        await database.prisma.conversation.findUnique({ where: { id: oldConversationId } }),
      ).toBeNull();
      const tables = await database.client.query<{ tablename: string }>(
        'SELECT tablename FROM pg_tables WHERE schemaname = $1',
        [database.schema],
      );
      for (const table of ['pricing_rules', 'pricing_rule_history', 'lead_evaluations'])
        expect(tables.rows.map((row) => row.tablename)).not.toContain(table);
      const columns = await database.client.query<{ column_name: string }>(
        'SELECT column_name FROM information_schema.columns WHERE table_schema = $1',
        [database.schema],
      );
      for (const column of [
        'flow_version',
        'analysis_version',
        'selected_size',
        'selected_detail',
        'detected_size',
        'detected_detail',
        'calculated_min_price',
        'pricing_rule_id',
        'price_sent_at',
      ])
        expect(columns.rows.map((row) => row.column_name)).not.toContain(column);
      const enums = await database.client.query<{ typname: string }>(
        'SELECT typname FROM pg_type JOIN pg_namespace n ON n.oid = typnamespace WHERE n.nspname = $1',
        [database.schema],
      );
      for (const name of [
        'flow_version',
        'analysis_version',
        'tattoo_size',
        'detail_level',
        'readiness_status',
        'review_reason',
      ])
        expect(enums.rows.map((row) => row.typname)).not.toContain(name);
    });
    it('preserves current intake, Vision V2_4, Quote, pricing models, account, channel and image', async () => {
      const lead = await database.prisma.lead.findUniqueOrThrow({
        where: { id: currentLeadId },
        include: { quote: true, aiAnalysis: true, conversation: true, images: true },
      });
      expect(lead).toMatchObject({
        targetSizeCm: 12,
        sameSizeAsReference: true,
        status: 'AUTO_QUOTED',
        aiAnalysis: { schemaVersion: 'VISION_V2_4', estimatedDensity: null },
        conversation: { currentState: 'ASK_ADVANCE_INTENT', targetSizeCm: 12 },
      });
      expect(lead.quote?.id).toBe(quoteId);
      expect(lead.quote?.snapshot).toEqual({ retained: true });
      expect(lead.images.map((image) => image.id)).toEqual([currentImageId]);
      expect(
        await database.prisma.pricingModelVersion.findUnique({ where: { id: modelId } }),
      ).toMatchObject({
        algorithmVersion: 'AREA_COLOR_SEPARABLE_V1',
        modelParameters: { retained: true },
      });
      expect(
        await database.prisma.whatsAppChannel.findUnique({ where: { id: channelId } }),
      ).toMatchObject({ accountId });
      expect(await database.prisma.user.findUnique({ where: { id: adminId } })).not.toBeNull();
    });
    it('rejects deleted states and aborts the migration when a current Quote conflicts with a purge candidate', async () => {
      await expect(
        database.client.query("UPDATE conversations SET current_state = 'ASK_SIZE' WHERE id = $1", [
          currentConversationId,
        ]),
      ).rejects.toThrow();
      let rolledBack = false;
      await expect(
        isolatedDatabase(async (name, client) => {
          if (name !== migrationName) return;
          const sql = readFileSync(`prisma/migrations/${migrationName}/migration.sql`, 'utf8');
          await seedBeforeCleanup(client, true);
          try {
            await client.query(sql);
          } catch (error) {
            await client.query('ROLLBACK');
            const retained = await client.query<{ count: string }>(
              'SELECT count(*) FROM leads WHERE id = $1',
              [oldLeadId],
            );
            expect(retained.rows[0].count).toBe('1');
            rolledBack = true;
            throw error;
          }
        }),
      ).rejects.toThrow('Current Quote references a Nita V1 lead');
      expect(rolledBack).toBe(true);
    }, 120_000);
  },
);
