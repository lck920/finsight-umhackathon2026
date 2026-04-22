import 'dotenv/config'; // must be first
import express from 'express';
import cors from 'cors';
import multer from 'multer';
import csvParser from 'csv-parser';
import { Readable } from 'stream';
import db from './db.js';
import { categoriseWithGLM, getRecommendationsAndForecast, generateReport } from './glm.js';

const app = express();
app.use(cors());
app.use(express.json());

const upload = multer({ storage: multer.memoryStorage() });

// --- Shared helper: build financial context from DB ---
function buildFinancialContext() {
  const getMonthKey = (date) => {
    if (!date) return null;
    if (date.includes('/')) {
      const parts = date.split('/');
      if (parts.length === 3) return `${parts[2]}-${parts[1].padStart(2, '0')}`;
    }
    if (date.includes('-')) return date.substring(0, 7);
    return null;
  };

  const categoryData = db.prepare(`
    SELECT Category as category, SUM(Sales) as amount
    FROM transactions
    GROUP BY Category
    ORDER BY amount DESC
  `).all();

  const transactions = db.prepare(`SELECT Order_Date, Sales, type FROM transactions`).all();

  let totalRevenue = 0;
  let totalExpenses = 0;
  const monthMap = {};

  transactions.forEach(tx => {
    const month = getMonthKey(tx.Order_Date);
    if (!month) return;

    if (!monthMap[month]) monthMap[month] = { month, revenue: 0, expenses: 0 };

    if (tx.type === 'income') {
      totalRevenue += tx.Sales;
      monthMap[month].revenue += tx.Sales;
    } else {
      totalExpenses += tx.Sales;
      monthMap[month].expenses += tx.Sales;
    }
  });

  const trendData = Object.values(monthMap).sort((a, b) => a.month.localeCompare(b.month));

  // Weighted moving average forecast (last 4 months)
  let predictedRevenue = 0;
  let predictedExpenses = 0;

  if (trendData.length > 0) {
    const recent = trendData.slice(-4);
    let weightSum = 0, revSum = 0, expSum = 0;
    recent.forEach((t, i) => {
      const weight = i + 1;
      weightSum += weight;
      revSum += t.revenue * weight;
      expSum += t.expenses * weight;
    });
    predictedRevenue = revSum / weightSum;
    predictedExpenses = expSum / weightSum;
  }

  const expectedProfit = predictedRevenue - predictedExpenses;
  const runwayMonths = expectedProfit < 0 ? 50000 / Math.abs(expectedProfit) : null;
  const round = (n) => Number(n.toFixed(2));

  return {
    summary: {
      totalRevenue: round(totalRevenue),
      totalExpenses: round(totalExpenses),
      netProfit: round(totalRevenue - totalExpenses),
    },
    trendData,
    categoryData,
    mathForecast: {
      predictedRevenue: round(predictedRevenue),
      predictedExpenses: round(predictedExpenses),
      expectedProfit: round(expectedProfit),
      runwayMonths: runwayMonths ? round(runwayMonths) : null,
    },
  };
}

// --- 1. Data Input & Categorisation ---

// Get all transactions
app.get('/api/transactions', (req, res) => {
  const transactions = db.prepare('SELECT * FROM transactions ORDER BY Row_ID DESC LIMIT 1000').all();
  res.json(transactions);
});

// Add a single manual transaction — GLM Call A categorises it
app.post('/api/transactions', async (req, res) => {
  try {
    const { Order_Date, Product_Name, Sales, Category, type } = req.body;

    let finalCategory = Category;
    let finalType = type || 'expense';

    // Call GLM if category is not provided or is the "auto" sentinel
    if (!finalCategory || finalCategory === 'Other' || finalCategory === 'Auto') {
      const glmResults = await categoriseWithGLM([{
        date: Order_Date,
        description: Product_Name,
        amount: parseFloat(Sales) || 0,
      }]);
      finalCategory = glmResults[0]?.category || 'Miscellaneous';
      finalType = glmResults[0]?.type || finalType;
    }

    const Order_ID = `MANUAL-${Date.now()}`;
    const stmt = db.prepare(
      'INSERT INTO transactions (Order_ID, Order_Date, Product_Name, Sales, Category, type) VALUES (?, ?, ?, ?, ?, ?)'
    );
    const result = stmt.run(Order_ID, Order_Date, Product_Name, parseFloat(Sales) || 0, finalCategory, finalType);

    res.json({
      Row_ID: result.lastInsertRowid,
      Order_Date,
      Product_Name,
      Sales: parseFloat(Sales) || 0,
      Category: finalCategory,
      type: finalType,
    });
  } catch (err) {
    console.error('POST /api/transactions error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// Upload CSV — GLM Call A categorises uncategorised rows in bulk
app.post('/api/transactions/upload', upload.single('file'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });

  const rawRows = [];
  const stream = Readable.from(req.file.buffer.toString());

  stream
    .pipe(csvParser())
    .on('data', (data) => {
      const Order_ID = data['Order_ID'] || data['order_id'] || `CSV-${Date.now()}-${Math.random()}`;
      const Order_Date = data['Order_Date'] || data['date'] || data['Date'] || '';
      const Product_Name = data['Product_Name'] || data['description'] || data['Description'] || 'Unknown';
      const Sales = parseFloat(data['Sales'] || data['amount'] || data['Amount'] || '0') || 0;
      const existingCategory = data['Category'] || data['category'] || null;
      const existingType = data['type'] || data['Type'] || null;

      rawRows.push({ Order_ID, Order_Date, Product_Name, Sales, existingCategory, existingType });
    })
    .on('end', async () => {
      try {
        const needsGLM = rawRows.filter(r => !r.existingCategory || r.existingCategory === 'Other');
        const alreadyCategorised = rawRows.filter(r => r.existingCategory && r.existingCategory !== 'Other');

        let glmResults = [];
        if (needsGLM.length > 0) {
          glmResults = await categoriseWithGLM(
            needsGLM.map(r => ({ date: r.Order_Date, description: r.Product_Name, amount: r.Sales }))
          );
        }

        let glmIdx = 0;
        const finalRows = rawRows.map(r => {
          if (!r.existingCategory || r.existingCategory === 'Other') {
            const glmRow = glmResults[glmIdx++] || {};
            return { ...r, Category: glmRow.category || 'Miscellaneous', type: glmRow.type || 'expense' };
          }
          return { ...r, Category: r.existingCategory, type: r.existingType || 'expense' };
        });

        const insert = db.prepare(
          'INSERT INTO transactions (Order_ID, Order_Date, Product_Name, Sales, Category, type) VALUES (?, ?, ?, ?, ?, ?)'
        );
        const insertMany = db.transaction((rows) => {
          for (const row of rows) {
            insert.run(row.Order_ID, row.Order_Date, row.Product_Name, row.Sales, row.Category, row.type);
          }
        });
        insertMany(finalRows);

        res.json({ message: `Successfully processed ${finalRows.length} transactions.` });
      } catch (err) {
        console.error('CSV upload GLM error:', err.message);
        res.status(500).json({ error: `GLM categorisation failed: ${err.message}` });
      }
    })
    .on('error', (err) => {
      res.status(500).json({ error: 'CSV parsing error: ' + err.message });
    });
});

// Update category manually
app.put('/api/transactions/:id', (req, res) => {
  const { category } = req.body;
  const stmt = db.prepare('UPDATE transactions SET Category = ? WHERE Row_ID = ?');
  stmt.run(category, req.params.id);
  res.json({ success: true });
});

// Delete a transaction
app.delete('/api/transactions/:id', (req, res) => {
  const stmt = db.prepare('DELETE FROM transactions WHERE Row_ID = ?');
  stmt.run(req.params.id);
  res.json({ success: true });
});

// --- 2. Financial Analysis & Forecasting ---

// Analytics: math-based data + GLM Call B narrative layer
app.get('/api/analytics', async (req, res) => {
  try {
    const context = buildFinancialContext();
    const glmOutput = await getRecommendationsAndForecast(context, null);

    res.json({
      summary: context.summary,
      trendData: context.trendData,
      categoryData: context.categoryData,
      forecast: {
        predictedRevenue: context.mathForecast.predictedRevenue,
        predictedExpenses: context.mathForecast.predictedExpenses,
        expectedProfit: context.mathForecast.expectedProfit,
        runwayMonths: context.mathForecast.runwayMonths,
        scenario_warning: glmOutput.forecast.scenario_warning,
      },
      recommendations: glmOutput.recommendations,
    });
  } catch (err) {
    console.error('GET /api/analytics error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// --- 3 & 4. AI Recommendations & Report ---

// Chat: GLM Call B with user message
app.post('/api/chat', async (req, res) => {
  const { message } = req.body;
  if (!message || typeof message !== 'string') {
    return res.status(400).json({ error: 'message field is required' });
  }

  try {
    const context = buildFinancialContext();
    const glmOutput = await getRecommendationsAndForecast(context, message);

    const isReport = message.toLowerCase().includes('report');
    const reply = glmOutput.chat_reply || 'I was unable to generate a response. Please try again.';

    res.json({ reply, isReport });
  } catch (err) {
    console.error('POST /api/chat error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// Report: GLM Call B → GLM Call C (fixes stuck /report page)
app.get('/api/report', async (req, res) => {
  try {
    const context = buildFinancialContext();
    const glmBOutput = await getRecommendationsAndForecast(context, null);
    const report = await generateReport(context, glmBOutput);

    res.json(report);
  } catch (err) {
    console.error('GET /api/report error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

const PORT = 3001;
app.listen(PORT, () => {
  console.log(`Backend server running on http://localhost:${PORT}`);
});
