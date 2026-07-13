/**
 * GIREAPP — Database Seed Script
 * Seeds 3 foundational courses (one per segment) per MVP scope M1
 */

import { PrismaClient, AcademicLevel, ContentType } from '@prisma/client';
import { hash } from 'bcryptjs';

const prisma = new PrismaClient();

async function main() {
  console.log('🌱 Starting database seed...');

  // ── 1. Create Admin User ──
  const adminEmail = 'admin@gireapp.com';
  const existingAdmin = await prisma.user.findUnique({ where: { email: adminEmail } });

  let adminId;
  if (!existingAdmin) {
    const adminPassword = process.env.ADMIN_SEED_PASSWORD;
    if (!adminPassword || adminPassword.length < 12) {
      throw new Error(
        'ADMIN_SEED_PASSWORD env var (min 12 chars) is required to seed the admin user. Never hardcode it.'
      );
    }
    const adminUser = await prisma.user.create({
      data: {
        name: 'System Admin',
        email: adminEmail,
        passwordHash: await hash(adminPassword, 12),
        role: 'ADMIN',
        emailVerified: new Date(),
      },
    });
    adminId = adminUser.id;
    console.log(`✅ Created Admin user: ${adminEmail}`);
  } else {
    adminId = existingAdmin.id;
    console.log('ℹ️ Admin user already exists.');
  }

  // ── 2. Seed Foundational Courses ──

  const seedCourses = [
    {
      title: 'Foundations of Physics: Mechanics',
      description: 'Master the basics of motion, forces, and energy. Tailored for WAEC and JAMB preparation.',
      academicLevel: AcademicLevel.SECONDARY,
      department: 'Science',
      thumbnailUrl: null,
      published: true,
      createdById: adminId,
      modules: [
        {
          title: 'Kinematics',
          order: 1,
          lessons: [
            {
              title: 'Introduction to Motion',
              contentType: ContentType.MARKDOWN,
              content: '# Introduction to Motion\n\nMotion is the change in position of an object over time. In physics, we describe motion using kinematics. Key concepts include displacement, velocity, and acceleration.\n\n### Key Formulas\n- Velocity $v = \\frac{d}{t}$\n- Acceleration $a = \\frac{\\Delta v}{t}$',
              order: 1,
              estimatedMinutes: 10,
            },
            {
              title: 'Equations of Uniformly Accelerated Motion',
              contentType: ContentType.MARKDOWN,
              content: '# The Four Equations of Motion\n\n1. $v = u + at$\n2. $s = ut + \\frac{1}{2}at^2$\n3. $v^2 = u^2 + 2as$\n4. $s = \\frac{1}{2}(u+v)t$\n\nWhere $u$ is initial velocity, $v$ is final velocity, $a$ is acceleration, $t$ is time, and $s$ is displacement.',
              order: 2,
              estimatedMinutes: 15,
            },
          ],
        },
      ],
      quizzes: [
        {
          title: 'Kinematics Quiz',
          timeLimitMin: 15,
          passingScore: 70,
          questions: [
            {
              text: 'Which of the following is a vector quantity?',
              explanation: 'Velocity has both magnitude and direction, making it a vector. Speed is a scalar.',
              order: 1,
              choices: [
                { text: 'Speed', isCorrect: false },
                { text: 'Velocity', isCorrect: true },
                { text: 'Distance', isCorrect: false },
                { text: 'Time', isCorrect: false },
              ]
            }
          ]
        }
      ]
    },
    {
      title: 'Academic Research Methodologies',
      description: 'A comprehensive guide to designing, conducting, and writing academic research for university students.',
      academicLevel: AcademicLevel.TERTIARY,
      department: 'Undergraduate',
      thumbnailUrl: null,
      published: true,
      createdById: adminId,
      modules: [
        {
          title: 'Research Design',
          order: 1,
          lessons: [
            {
              title: 'Qualitative vs Quantitative',
              contentType: ContentType.MARKDOWN,
              content: '# Qualitative vs Quantitative Research\n\nUnderstand the fundamental differences between qualitative (exploratory, text-based) and quantitative (measured, number-based) research methods.',
              order: 1,
              estimatedMinutes: 20,
            },
          ],
        },
      ],
      quizzes: [
        {
          title: 'Research Basics',
          timeLimitMin: 20,
          passingScore: 70,
          questions: [
            {
              text: 'Which research method relies primarily on numerical data?',
              explanation: 'Quantitative research uses numerical data and statistical analysis.',
              order: 1,
              choices: [
                { text: 'Qualitative', isCorrect: false },
                { text: 'Quantitative', isCorrect: true },
                { text: 'Mixed Methods', isCorrect: false },
                { text: 'Ethnography', isCorrect: false },
              ]
            }
          ]
        }
      ]
    },
    {
      title: 'Data Analytics for Business',
      description: 'Learn how to transform raw data into actionable business intelligence using industry-standard tools.',
      academicLevel: AcademicLevel.PROFESSIONAL,
      department: 'Data Analytics',
      thumbnailUrl: null,
      published: true,
      createdById: adminId,
      modules: [
        {
          title: 'Data Fundamentals',
          order: 1,
          lessons: [
            {
              title: 'Introduction to SQL',
              contentType: ContentType.MARKDOWN,
              content: '# Introduction to SQL\n\nSQL (Structured Query Language) is the standard language for relational database management systems. \n\n```sql\nSELECT * FROM users WHERE active = true;\n```',
              order: 1,
              estimatedMinutes: 25,
            },
          ],
        },
      ],
      quizzes: [
        {
          title: 'SQL Basics',
          timeLimitMin: 30,
          passingScore: 80,
          questions: [
            {
              text: 'Which SQL statement is used to extract data from a database?',
              explanation: 'The SELECT statement is used to query and extract data from tables.',
              order: 1,
              choices: [
                { text: 'GET', isCorrect: false },
                { text: 'EXTRACT', isCorrect: false },
                { text: 'SELECT', isCorrect: true },
                { text: 'PULL', isCorrect: false },
              ]
            }
          ]
        }
      ]
    }
  ];

  for (const courseData of seedCourses) {
    const existingCourse = await prisma.course.findFirst({
      where: { title: courseData.title },
    });

    if (!existingCourse) {
      await prisma.course.create({
        data: {
          title: courseData.title,
          description: courseData.description,
          academicLevel: courseData.academicLevel,
          department: courseData.department,
          thumbnailUrl: courseData.thumbnailUrl,
          published: courseData.published,
          createdById: courseData.createdById,
          modules: {
            create: courseData.modules.map(module => ({
              title: module.title,
              order: module.order,
              lessons: {
                create: module.lessons.map(lesson => ({
                  title: lesson.title,
                  contentType: lesson.contentType,
                  content: lesson.content,
                  order: lesson.order,
                  estimatedMinutes: lesson.estimatedMinutes,
                }))
              }
            }))
          },
          quizzes: {
            create: courseData.quizzes.map(quiz => ({
              title: quiz.title,
              timeLimitMin: quiz.timeLimitMin,
              passingScore: quiz.passingScore,
              questions: {
                create: quiz.questions.map(q => ({
                  text: q.text,
                  explanation: q.explanation,
                  order: q.order,
                  choices: {
                    create: q.choices.map((c, index) => ({
                      text: c.text,
                      isCorrect: c.isCorrect,
                      order: index + 1
                    }))
                  }
                }))
              }
            }))
          }
        },
      });
      console.log(`✅ Seeded course: ${courseData.title}`);
    } else {
      console.log(`ℹ️ Course already exists: ${courseData.title}`);
    }
  }

  console.log('✅ Seed completed successfully.');
}

main()
  .catch((e) => {
    console.error('❌ Seeding failed:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
