// IndexedDB Database Manager for PDF Quiz Application
class DatabaseManager {
	constructor() {
		this.dbName = "QuizDB";
		this.dbVersion = 2; // Increased version to trigger schema update
		this.db = null;
		this.events = {};
	}

	async initialize() {
		try {
			this.db = await this.openDatabase();
			console.log("✅ Database initialized successfully");
			return true;
		} catch (error) {
			console.error("❌ Database initialization failed:", error);
			throw error;
		}
	}

	async openDatabase() {
		return new Promise((resolve, reject) => {
			const request = indexedDB.open(this.dbName, this.dbVersion);

			request.onerror = () => {
				reject(new Error(`Failed to open database: ${request.error}`));
			};

			request.onsuccess = () => {
				resolve(request.result);
			};

			request.onupgradeneeded = (event) => {
				const db = event.target.result;
				this.createStores(db);
			};
		});
	}

	createStores(db) {
		// Store PDF metadata and processing status
		if (!db.objectStoreNames.contains("pdfs")) {
			const pdfStore = db.createObjectStore("pdfs", { keyPath: "id" });
			pdfStore.createIndex("filename", "filename", { unique: false });
			pdfStore.createIndex("uploadDate", "uploadDate", { unique: false });
			pdfStore.createIndex("lastAccessed", "lastAccessed", {
				unique: false,
			});
			console.log("📄 Created PDFs object store");
		}

		// Store individual questions
		if (!db.objectStoreNames.contains("questions")) {
			const questionStore = db.createObjectStore("questions", {
				keyPath: "id", // Use single unique ID instead of compound key
			});
			questionStore.createIndex("pdfId", "pdfId", { unique: false });
			questionStore.createIndex("batchNumber", "batchNumber", {
				unique: false,
			});
			questionStore.createIndex("createdDate", "createdDate", {
				unique: false,
			});
			questionStore.createIndex(
				"pdfIdQuestionId",
				["pdfId", "questionId"],
				{
					unique: true,
				},
			);
			console.log("❓ Created Questions object store");
		}

		// Store user quiz sessions and progress
		if (!db.objectStoreNames.contains("sessions")) {
			const sessionStore = db.createObjectStore("sessions", {
				keyPath: "id",
			});
			sessionStore.createIndex("pdfId", "pdfId", { unique: false });
			sessionStore.createIndex("startDate", "startDate", {
				unique: false,
			});
			console.log("📊 Created Sessions object store");
		}
	}

	// PDF Management Methods
	async storePDF(pdfData) {
		const transaction = this.db.transaction(["pdfs"], "readwrite");
		const store = transaction.objectStore("pdfs");

		const pdfRecord = {
			id: pdfData.id,
			filename: pdfData.filename,
			fileSize: pdfData.fileSize,
			uploadDate: new Date(),
			lastAccessed: new Date(),
			textContent: pdfData.textContent,
			totalQuestions: pdfData.totalQuestions || 0,
			isComplete: pdfData.isComplete || false,
			processingStatus: pdfData.processingStatus || "pending",
			batchCount: pdfData.batchCount || 1,
			completedBatches: pdfData.completedBatches || 0,
		};

		return new Promise((resolve, reject) => {
			const request = store.put(pdfRecord);
			request.onsuccess = () => {
				console.log(`📄 PDF stored: ${pdfRecord.filename}`);
				resolve(pdfRecord);
			};
			request.onerror = () => reject(request.error);
		});
	}

	async getPDF(pdfId) {
		const transaction = this.db.transaction(["pdfs"], "readonly");
		const store = transaction.objectStore("pdfs");

		return new Promise((resolve, reject) => {
			const request = store.get(pdfId);
			request.onsuccess = () => {
				if (request.result) {
					// Update last accessed time
					this.updatePDFLastAccessed(pdfId);
				}
				resolve(request.result);
			};
			request.onerror = () => reject(request.error);
		});
	}

	async updatePDFLastAccessed(pdfId) {
		const transaction = this.db.transaction(["pdfs"], "readwrite");
		const store = transaction.objectStore("pdfs");

		return new Promise((resolve, reject) => {
			const getRequest = store.get(pdfId);
			getRequest.onsuccess = () => {
				if (getRequest.result) {
					const pdf = getRequest.result;
					pdf.lastAccessed = new Date();

					const updateRequest = store.put(pdf);
					updateRequest.onsuccess = () => resolve(pdf);
					updateRequest.onerror = () => reject(updateRequest.error);
				} else {
					resolve(null);
				}
			};
			getRequest.onerror = () => reject(getRequest.error);
		});
	}

	async updatePDFProgress(pdfId, completedBatch) {
		const transaction = this.db.transaction(["pdfs"], "readwrite");
		const store = transaction.objectStore("pdfs");

		return new Promise((resolve, reject) => {
			const getRequest = store.get(pdfId);
			getRequest.onsuccess = () => {
				if (getRequest.result) {
					const pdf = getRequest.result;
					pdf.completedBatches = Math.max(
						pdf.completedBatches,
						completedBatch,
					);
					pdf.lastAccessed = new Date();

					const updateRequest = store.put(pdf);
					updateRequest.onsuccess = () => {
						console.log(
							`📊 PDF progress updated: ${pdf.filename} (${pdf.completedBatches}/${pdf.batchCount})`,
						);
						resolve(pdf);
					};
					updateRequest.onerror = () => reject(updateRequest.error);
				} else {
					reject(new Error("PDF not found"));
				}
			};
			getRequest.onerror = () => reject(getRequest.error);
		});
	}

	async completePDFProcessing(pdfId) {
		const transaction = this.db.transaction(["pdfs"], "readwrite");
		const store = transaction.objectStore("pdfs");

		return new Promise((resolve, reject) => {
			const getRequest = store.get(pdfId);
			getRequest.onsuccess = () => {
				if (getRequest.result) {
					const pdf = getRequest.result;
					pdf.isComplete = true;
					pdf.processingStatus = "complete";
					pdf.lastAccessed = new Date();

					const updateRequest = store.put(pdf);
					updateRequest.onsuccess = () => {
						console.log(
							`✅ PDF processing completed: ${pdf.filename}`,
						);
						resolve(pdf);
					};
					updateRequest.onerror = () => reject(updateRequest.error);
				} else {
					reject(new Error("PDF not found"));
				}
			};
			getRequest.onerror = () => reject(getRequest.error);
		});
	}

	// Alias for completePDFProcessing to match batch processor usage
	async markPDFComplete(pdfId) {
		return this.completePDFProcessing(pdfId);
	}

	// Question Management Methods
	async storeQuestions(pdfId, questions, batchNumber) {
		console.log(
			`💾 Storing ${questions.length} questions for PDF ${pdfId.substring(
				0,
				8,
			)}... batch ${batchNumber}`,
		);

		const transaction = this.db.transaction(["questions"], "readwrite");
		const store = transaction.objectStore("questions");

		const promises = questions.map((question, index) => {
			// For synced questions, questionId is preserved. For new AI questions, it's generated.
			const generatedQuestionId =
				question.questionId || (batchNumber - 1) * 1000 + index + 1;

			const questionRecord = {
				id: `${pdfId}_${generatedQuestionId}`, // Unique primary key for the record
				pdfId: pdfId,
				questionId: generatedQuestionId,
				batchNumber: question.batchNumber || batchNumber, // Use original batchNumber from sync if present
				question: question.question,
				options: question.options,
				correctAnswer: question.correctAnswer,
				explanation: question.explanation,
				createdDate: new Date(),
				source: question.source || "ai",
			};

			return new Promise((resolve, reject) => {
				const request = store.put(questionRecord);
				request.onsuccess = () => {
					console.log(
						`✅ Stored question ${questionRecord.id} (QID: ${questionRecord.questionId})`,
					);
					resolve(questionRecord);
				};
				request.onerror = () => {
					console.error(
						`❌ Failed to store question ${questionRecord.id} (QID: ${questionRecord.questionId}):`,
						request.error,
					);
					reject(request.error);
				};
			});
		});

		try {
			const results = await Promise.all(promises);
			console.log(
				`✅ Successfully stored ${results.length} questions for batch ${batchNumber}`,
			);

			// Verify storage by counting total questions for this PDF
			const totalCount = await this.getQuestionCount(pdfId);
			console.log(
				`📊 Total questions now stored for this PDF: ${totalCount}`,
			);

			// Update the PDF record with the current total question count
			await this.updatePDFQuestionCount(pdfId, totalCount);

			return results;
		} catch (error) {
			console.error(
				`❌ Error storing questions for batch ${batchNumber}:`,
				error,
			);
			// This error aborts the transaction, which is expected on constraint violation.
			throw error;
		}
	}

	async getQuestions(pdfId, batchNumber = null) {
		const transaction = this.db.transaction(["questions"], "readonly");
		const store = transaction.objectStore("questions");
		const index = store.index("pdfId");

		return new Promise((resolve, reject) => {
			const request = index.getAll(pdfId);
			request.onsuccess = () => {
				let questions = request.result;

				// Filter by batch number if specified
				if (batchNumber !== null) {
					questions = questions.filter(
						(q) => q.batchNumber === batchNumber,
					);
				}

				// Sort by question ID
				questions.sort((a, b) => a.questionId - b.questionId);
				resolve(questions);
			};
			request.onerror = () => reject(request.error);
		});
	}

	async getQuestionCount(pdfId) {
		const transaction = this.db.transaction(["questions"], "readonly");
		const store = transaction.objectStore("questions");
		const index = store.index("pdfId");

		return new Promise((resolve, reject) => {
			const request = index.count(pdfId);
			request.onsuccess = () => {
				console.log(
					`📊 Question count for PDF ${pdfId.substring(0, 8)}...: ${request.result}`,
				);
				resolve(request.result);
			};
			request.onerror = () => reject(request.error);
		});
	}

	async getAllQuestionsDebug(pdfId) {
		const transaction = this.db.transaction(["questions"], "readonly");
		const store = transaction.objectStore("questions");
		const index = store.index("pdfId");

		return new Promise((resolve, reject) => {
			const request = index.getAll(pdfId);
			request.onsuccess = () => {
				const questions = request.result;
				console.log(
					`🔍 DEBUG: Found ${questions.length} questions for PDF:`,
					{
						pdfId: `${pdfId.substring(0, 8)}...`,
						totalQuestions: questions.length,
						batchBreakdown: questions.reduce((acc, q) => {
							acc[q.batchNumber] = (acc[q.batchNumber] || 0) + 1;
							return acc;
						}, {}),
						questionIds: questions
							.map((q) => q.questionId)
							.sort((a, b) => a - b),
					},
				);
				resolve(questions);
			};
			request.onerror = () => reject(request.error);
		});
	}

	// Session Management Methods
	async storeSession(sessionData) {
		const transaction = this.db.transaction(["sessions"], "readwrite");
		const store = transaction.objectStore("sessions");

		const sessionRecord = {
			id: sessionData.id || this.generateUUID(),
			pdfId: sessionData.pdfId,
			startDate: sessionData.startDate || new Date(),
			endDate: sessionData.endDate || null,
			currentQuestion: sessionData.currentQuestion || 0,
			answers: sessionData.answers || [],
			isComplete: sessionData.isComplete || false,
			score: sessionData.score || null,
			timeSpent: sessionData.timeSpent || 0,
		};

		return new Promise((resolve, reject) => {
			const request = store.put(sessionRecord);
			request.onsuccess = () => {
				console.log(`📊 Session stored: ${sessionRecord.id}`);
				resolve(sessionRecord);
			};
			request.onerror = () => reject(request.error);
		});
	}

	async getSession(sessionId) {
		const transaction = this.db.transaction(["sessions"], "readonly");
		const store = transaction.objectStore("sessions");

		return new Promise((resolve, reject) => {
			const request = store.get(sessionId);
			request.onsuccess = () => resolve(request.result);
			request.onerror = () => reject(request.error);
		});
	}

	async getSessionsForPDF(pdfId) {
		const transaction = this.db.transaction(["sessions"], "readonly");
		const store = transaction.objectStore("sessions");
		const index = store.index("pdfId");

		return new Promise((resolve, reject) => {
			const request = index.getAll(pdfId);
			request.onsuccess = () => {
				const sessions = request.result.sort(
					(a, b) => b.startDate - a.startDate,
				);
				resolve(sessions);
			};
			request.onerror = () => reject(request.error);
		});
	}

	// Utility Methods
	async generatePDFHash(fileContent) {
		const encoder = new TextEncoder();
		const data = encoder.encode(fileContent);
		const hashBuffer = await crypto.subtle.digest("SHA-256", data);
		const hashArray = Array.from(new Uint8Array(hashBuffer));
		return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
	}

	generateUUID() {
		return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
			const r = (Math.random() * 16) | 0;
			const v = c === "x" ? r : (r & 0x3) | 0x8;
			return v.toString(16);
		});
	}

	// Cache Management
	async cleanupOldPDFs() {
		const _maxPDFs = 50;
		const maxAge = 30 * 24 * 60 * 60 * 1000; // 30 days
		const cutoffDate = new Date(Date.now() - maxAge);

		const transaction = this.db.transaction(["pdfs"], "readwrite");
		const store = transaction.objectStore("pdfs");
		const index = store.index("lastAccessed");

		return new Promise((resolve, reject) => {
			const request = index.openCursor(
				IDBKeyRange.upperBound(cutoffDate),
			);
			const toDelete = [];

			request.onsuccess = (event) => {
				const cursor = event.target.result;
				if (cursor) {
					toDelete.push(cursor.value.id);
					cursor.continue();
				} else {
					// Delete old PDFs and their questions
					Promise.all(
						toDelete.map((id) => this.deletePDFAndQuestions(id)),
					)
						.then(() => {
							console.log(
								`🧹 Cleaned up ${toDelete.length} old PDFs`,
							);
							resolve(toDelete.length);
						})
						.catch(reject);
				}
			};
			request.onerror = () => reject(request.error);
		});
	}

	async deletePDFAndQuestions(pdfId) {
		const transaction = this.db.transaction(
			["pdfs", "questions", "sessions"],
			"readwrite",
		);

		// Delete PDF
		const pdfStore = transaction.objectStore("pdfs");
		pdfStore.delete(pdfId);

		// Delete questions
		const questionStore = transaction.objectStore("questions");
		const questionIndex = questionStore.index("pdfId");
		const questionRequest = questionIndex.openCursor(
			IDBKeyRange.only(pdfId),
		);

		questionRequest.onsuccess = (event) => {
			const cursor = event.target.result;
			if (cursor) {
				cursor.delete();
				cursor.continue();
			}
		};

		// Delete sessions
		const sessionStore = transaction.objectStore("sessions");
		const sessionIndex = sessionStore.index("pdfId");
		const sessionRequest = sessionIndex.openCursor(IDBKeyRange.only(pdfId));

		sessionRequest.onsuccess = (event) => {
			const cursor = event.target.result;
			if (cursor) {
				cursor.delete();
				cursor.continue();
			}
		};

		return new Promise((resolve, reject) => {
			transaction.oncomplete = () => resolve();
			transaction.onerror = () => reject(transaction.error);
		});
	}

	// Event system
	on(event, callback) {
		if (!this.events[event]) {
			this.events[event] = [];
		}
		this.events[event].push(callback);
	}

	emit(event, data) {
		if (this.events[event]) {
			this.events[event].forEach((callback) => callback(data));
		}
	}

	async updatePDFQuestionCount(pdfId, totalCount) {
		const transaction = this.db.transaction(["pdfs"], "readwrite");
		const store = transaction.objectStore("pdfs");

		return new Promise((resolve, reject) => {
			const getRequest = store.get(pdfId);
			getRequest.onsuccess = () => {
				if (getRequest.result) {
					const pdf = getRequest.result;
					pdf.totalQuestions = totalCount;
					pdf.lastAccessed = new Date();

					const updateRequest = store.put(pdf);
					updateRequest.onsuccess = () => resolve(pdf);
					updateRequest.onerror = () => reject(updateRequest.error);
				} else {
					reject(new Error("PDF not found"));
				}
			};
			getRequest.onerror = () => reject(getRequest.error);
		});
	}

	async storeUserAnswers(pdfId, userAnswers, flaggedQuestions) {
		console.log(
			`[DB] storeUserAnswers called for PDF ${pdfId.substring(0, 8)}... with ${userAnswers.length} answers`,
		);
		const transaction = this.db.transaction(["pdfs"], "readwrite");
		const store = transaction.objectStore("pdfs");

		return new Promise((resolve, reject) => {
			const getRequest = store.get(pdfId);
			getRequest.onsuccess = () => {
				if (getRequest.result) {
					console.log(
						`[DB] Found PDF for storing answers: ${getRequest.result.filename}`,
					);
					const pdf = getRequest.result;
					pdf.userAnswers = userAnswers;
					pdf.flaggedQuestions = flaggedQuestions;
					pdf.lastAnswerSaved = new Date();

					const updateRequest = store.put(pdf);
					updateRequest.onsuccess = () => {
						console.log(
							`📝 Saved ${userAnswers.filter((a) => a !== null).length} user answers for PDF ${pdfId.substring(0, 8)}...`,
						);
						resolve(pdf);
					};
					updateRequest.onerror = () => {
						console.error(
							`[DB] Error updating PDF with answers:`,
							updateRequest.error,
						);
						reject(updateRequest.error);
					};
				} else {
					console.error(
						`[DB] PDF ${pdfId} not found when trying to store user answers`,
					);
					console.log(`[DB] Attempting to list all PDFs to debug...`);

					// Debug: List all PDFs to see what's in the database
					const debugTransaction = this.db.transaction(
						["pdfs"],
						"readonly",
					);
					const debugStore = debugTransaction.objectStore("pdfs");
					const debugRequest = debugStore.getAll();

					debugRequest.onsuccess = () => {
						console.log(
							`[DB] All PDFs in database:`,
							debugRequest.result.map((pdf) => ({
								id: `${pdf.id.substring(0, 8)}...`,
								filename: pdf.filename,
							})),
						);
					};

					reject(new Error("PDF not found"));
				}
			};
			getRequest.onerror = () => {
				console.error(
					`[DB] Error retrieving PDF for storing answers:`,
					getRequest.error,
				);
				reject(getRequest.error);
			};
		});
	}

	async getUserAnswers(pdfId) {
		const transaction = this.db.transaction(["pdfs"], "readonly");
		const store = transaction.objectStore("pdfs");

		return new Promise((resolve, reject) => {
			const request = store.get(pdfId);
			request.onsuccess = () => {
				if (request.result?.userAnswers) {
					console.log(
						`📝 Loaded ${request.result.userAnswers.filter((a) => a !== null).length} saved user answers for PDF ${pdfId.substring(0, 8)}...`,
					);
					resolve({
						userAnswers: request.result.userAnswers,
						flaggedQuestions: request.result.flaggedQuestions,
					});
				} else {
					// No saved answers found
					resolve({
						userAnswers: [],
						flaggedQuestions: [],
					});
				}
			};
			request.onerror = () => reject(request.error);
		});
	}

	async clearUserAnswers(pdfId) {
		const transaction = this.db.transaction(["pdfs"], "readwrite");
		const store = transaction.objectStore("pdfs");

		return new Promise((resolve, reject) => {
			const getRequest = store.get(pdfId);
			getRequest.onsuccess = () => {
				if (getRequest.result) {
					const pdf = getRequest.result;
					pdf.userAnswers = [];
					pdf.lastAnswerSaved = null;

					const updateRequest = store.put(pdf);
					updateRequest.onsuccess = () => {
						console.log(
							`🧹 Cleared user answers for PDF ${pdfId.substring(0, 8)}...`,
						);
						resolve(pdf);
					};
					updateRequest.onerror = () => reject(updateRequest.error);
				} else {
					reject(new Error("PDF not found"));
				}
			};
			getRequest.onerror = () => reject(getRequest.error);
		});
	}

	// ≡≡≡≡≡≡≡ Sync Support Methods (metadata-only transfers) ≡≡≡≡≡≡≡

	// Return PDF metadata without the heavy textContent field so it can be transferred quickly over the wire
	async getPDFMetadata(pdfId) {
		const pdf = await this.getPDF(pdfId);
		if (!pdf) return null;

		// Create a shallow copy and strip the large textContent payload if present
		const metadata = { ...pdf };
		delete metadata.textContent;
		return metadata;
	}

	// Store just the metadata (no textContent) when data is synced from another peer
	async storePDFMetadata(metadata) {
		console.log(`[DB] Storing synced metadata for PDF:`, metadata.id);
		// Ensure we never store large content accidentally
		const cleaned = { ...metadata };
		delete cleaned.textContent;

		// Re-use the existing storePDF logic so we benefit from a single code path
		// but override textContent with an empty string to keep record sizes small.
		return this.storePDF({ ...cleaned, textContent: "" });
	}

	// Import metadata and its associated questions coming from the sync engine
	async importSyncedData(metadata, questions, userAnswers = []) {
		console.log(`[DB] importSyncedData called with:`, {
			metadataId: metadata?.id,
			questionsCount: questions?.length || 0,
			userAnswersCount: userAnswers?.length || 0,
		});

		try {
			// Check if the PDF already exists locally
			const existingPDF = await new Promise((resolve, reject) => {
				const transaction = this.db.transaction("pdfs", "readonly");
				const store = transaction.objectStore("pdfs");
				const request = store.get(metadata.id);

				request.onsuccess = () => resolve(request.result);
				request.onerror = () => reject(request.error);
			});

			if (existingPDF) {
				console.log(
					`[DB] PDF ${metadata.id} already exists. Merging answers.`,
				);
				// If it exists, just update the answers, don't re-import everything.
				try {
					const existingAnswers = await this.getUserAnswers(
						metadata.id,
					);
					console.log(
						`[DB] Retrieved ${existingAnswers.length} existing answers`,
					);

					// A simple merge: incoming answers overwrite existing ones if they exist at the same index.
					// This could be made more sophisticated (e.g., based on timestamps) if needed.
					const mergedAnswers = [...existingAnswers];
					userAnswers.forEach((answer, index) => {
						if (answer !== null) {
							// Only overwrite with non-empty answers
							mergedAnswers[index] = answer;
						}
					});

					console.log(
						`[DB] Attempting to store ${mergedAnswers.length} merged answers`,
					);
					await this.storeUserAnswers(metadata.id, mergedAnswers);
					console.log(
						`[DB] Successfully merged ${mergedAnswers.length} answers.`,
					);
				} catch (answerError) {
					console.error(`[DB] Error merging answers:`, answerError);
					// If answer merging fails, we should still consider the sync successful
					// since the PDF and questions already exist
					console.log(
						`[DB] Continuing despite answer merge error...`,
					);
				}
			} else {
				console.log(
					`[DB] PDF ${metadata.id} is new. Performing full import.`,
				);
				// If it's a new PDF, perform the full import.
				// 1. Persist the metadata first so foreign-key style look-ups succeed
				console.log(`[DB] Step 1: Storing PDF metadata...`);
				await this.storePDFMetadata(metadata);

				// 2. Store all questions in a single, efficient transaction.
				console.log(
					`[DB] Step 2: Storing ${questions.length} questions...`,
				);
				await this.storeQuestions(metadata.id, questions, 1);

				// 3. If user answers were synced, store them as well.
				if (userAnswers && userAnswers.length > 0) {
					console.log(
						`[DB] Step 3: Storing ${userAnswers.length} synced user answers.`,
					);
					await this.storeUserAnswers(metadata.id, userAnswers);
				} else {
					console.log(`[DB] Step 3: No user answers to store.`);
				}
			}

			console.log(
				`📥 Imported/Updated data for PDF ${metadata.id} – ${questions.length} questions.`,
			);
		} catch (error) {
			console.error(`[DB] Error in importSyncedData:`, error);
			throw error;
		}
	}
}

export { DatabaseManager };
