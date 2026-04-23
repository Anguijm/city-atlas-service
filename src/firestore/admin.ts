import 'server-only';
import { initializeApp, getApps, cert } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

function createAdminDb() {
  try {
    if (getApps().length === 0) {
      const serviceAccountKey = process.env.FIREBASE_SERVICE_ACCOUNT_KEY;

      if (serviceAccountKey) {
        initializeApp({
          credential: cert(JSON.parse(serviceAccountKey)),
        });
      } else {
        // Application Default Credentials (Cloud Run, local dev with gcloud auth)
        initializeApp();
      }
    }

    return getFirestore(getApps()[0], 'urbanexplorer');
  } catch (error) {
    console.error('[firebaseAdmin] CRITICAL: Failed to initialize Firebase Admin:', error);
    throw error;
  }
}

export const adminDb = createAdminDb();
