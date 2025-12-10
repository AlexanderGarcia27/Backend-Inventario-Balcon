const express = require("express");
const cors = require("cors");
const { db } = require("./firebase");

const app = express();
app.use(cors());
app.use(express.json());

// ----------------------
// GENERAR CODIGO PRODUCTO
// ----------------------
async function generarCodigoProducto() {
  const productos = await db.collection("productos").get();
  const total = productos.size + 1;
  return "P" + String(total).padStart(3, "0");
}

// ----------------------
// GENERAR CODIGO VENTA
// ----------------------
async function generarCodigoVenta() {
  const ventas = await db.collection("ventas").get();
  const total = ventas.size + 1;
  return "V" + String(total).padStart(3, "0");
}

// ----------------------------------------------
// CRUD PRODUCTOS
// ----------------------------------------------

// ----------------------------------------------
// CRUD PRODUCTOS (VERSION MEJORADA PARA LOTES)
// ----------------------------------------------

// Crear producto(s) - Acepta un objeto simple O un array de objetos
app.post("/productos", async (req, res) => {
  try {
    // 1. Determinar si es un solo producto o una lista (array)
    const productosParaGuardar = Array.isArray(req.body) ? req.body : [req.body];

    // 2. Obtener el último número de código UNA SOLA VEZ
    const snapshot = await db.collection("productos").get();
    let ultimoNumero = 0;
    snapshot.forEach(doc => {
      const data = doc.data();
      if (data.codigo) {
        const num = parseInt(data.codigo.replace("P", ""));
        if (num > ultimoNumero) ultimoNumero = num;
      }
    });

    const productosAgregados = [];
    let productosOmitidos = 0;

    // 3. Iterar sobre la lista de productos
    for (const producto of productosParaGuardar) {
      // CRÍTICO: FILTRAR PRODUCTOS INVÁLIDOS (LÍNEAS VACÍAS DEL CSV)
      if (!producto || !producto.nombre) {
        productosOmitidos++;
        continue; // Saltar al siguiente producto si no tiene nombre
      }

      // 4. Generar el nuevo código de forma incremental
      ultimoNumero++;
      const nuevoCodigo = "P" + ultimoNumero.toString().padStart(3, "0");

      // 5. Crear el nuevo producto (asegurando valores por defecto)
      const nuevoProducto = {
        nombre: producto.nombre,
        // Los valores ausentes ahora serán 0 o 'Sin Categoría', no undefined
        precio: Number(producto.precio) || 0,
        precioCompra: Number(producto.precioCompra) || 0,
        categoria: producto.categoria || 'Sin Categoría',
        stock: Number(producto.stock) || 0,
        codigo: nuevoCodigo,
        creadoEn: new Date()
      };

      // 6. Guardar en Firestore
      const productoRef = await db.collection("productos").add(nuevoProducto);

      productosAgregados.push({
        id: productoRef.id,
        nombre: nuevoProducto.nombre,
        codigo: nuevoCodigo
      });
    }

    if (productosAgregados.length === 0) {
      return res.status(400).json({ error: "No se encontró ningún producto válido para agregar." });
    }

    res.json({
      mensaje: "Productos agregados correctamente.",
      total_agregados: productosAgregados.length,
      total_omitidos: productosOmitidos,
      productos: productosAgregados
    });

  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Error al agregar productos" });
  }
});


// Listar productos
// Listar productos en orden por código
app.get("/productos", async (req, res) => {
  try {
    const snapshot = await db.collection("productos").get();
    const lista = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));

    // Ordenar por el número dentro del código: P001 → 1, P087 → 87, etc.
    lista.sort((a, b) => {
      const numA = parseInt(a.codigo.replace("P", ""));
      const numB = parseInt(b.codigo.replace("P", ""));
      return numA - numB; // orden ascendente
    });

    res.json(lista);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});


// Actualizar producto
// Actualizar producto
app.put("/productos/:id", async (req, res) => {
  try {
    const updateData = { ...req.body };

    // Asegurar que los campos numéricos se conviertan a número antes de actualizar
    if (updateData.precio !== undefined) {
      updateData.precio = Number(updateData.precio) || 0;
    }
    if (updateData.stock !== undefined) {
      updateData.stock = Number(updateData.stock) || 0;
    }
    // NUEVO: Manejo del precioCompra
    if (updateData.precioCompra !== undefined) {
      updateData.precioCompra = Number(updateData.precioCompra) || 0;
    }

    await db.collection("productos").doc(req.params.id).update(updateData);
    res.json({ mensaje: "Producto actualizado" });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Eliminar producto
app.delete("/productos/:id", async (req, res) => {
  try {
    await db.collection("productos").doc(req.params.id).delete();
    res.json({ mensaje: "Producto eliminado" });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});
// ----------------------------------------------
// GESTIÓN DE DATOS PELIGROSA (BORRADO TOTAL)
// ----------------------------------------------

/**
 * Función auxiliar para borrar una colección completa (Peligrosa)
 * @param {string} collectionName - Nombre de la colección a borrar
 */
async function deleteCollection(collectionName) {
  const snapshot = await db.collection(collectionName).get();
  const batch = db.batch();
  snapshot.docs.forEach(doc => {
    batch.delete(doc.ref);
  });
  await batch.commit();
  return snapshot.size;
}

// Endpoint para borrar todos los productos y todas las ventas
app.delete("/administracion/borrar-todo-peligro", async (req, res) => {
  try {
    // Opcional: Agregar aquí una verificación de token o credencial de administrador
    // if (req.headers['x-admin-key'] !== 'SU_CLAVE_SECRETA') {
    //   return res.status(403).json({ error: "Acceso denegado. Se requiere clave de administrador." });
    // }

    console.log("INICIANDO BORRADO TOTAL DE DATOS...");

    const productosBorrados = await deleteCollection("productos");
    const ventasBoradas = await deleteCollection("ventas");

    console.log("BORRADO TOTAL FINALIZADO.");

    res.json({
      mensaje: "¡PELIGRO! Todas las colecciones han sido vaciadas.",
      detalle: {
        productos_eliminados: productosBorrados,
        ventas_eliminadas: ventasBoradas,
      },
    });
  } catch (error) {
    console.error("Error en el borrado total:", error);
    res.status(500).json({ error: "Error fatal al intentar borrar colecciones" });
  }
});

// ----------------------------------------------
// VENTAS
// ----------------------------------------------

// Crear una venta
// Crear una venta (VERSION MEJORADA: Incluye precio unitario y precio de compra)
app.post("/ventas", async (req, res) => {
  try {
    // AÑADIDO 'precio' (venta unitario) y 'precioCompra' (unitario del producto)
    const { productoId, cantidad, precio, total, monto, cambio, nota, precioCompra } = req.body;

    // NOTA: Ahora validamos que 'precio' y 'precioCompra' también estén presentes, o manejamos sus valores por defecto.
    if (!productoId || !cantidad || !total || !monto || precio === undefined || precioCompra === undefined) {
      // Si precio o precioCompra son 0, están presentes, pero si son undefined, falta el dato.
      return res.status(400).json({ error: "Faltan datos obligatorios (productoId, cantidad, precio, total, monto, precioCompra)" });
    }

    const cantidadNum = Number(cantidad);
    const precioVentaNum = Number(precio);
    const totalNum = Number(total);
    const montoNum = Number(monto);
    const cambioNum = Number(cambio);
    // Asegurar que el precio de compra unitario sea un número
    const precioCompraNum = Number(precioCompra);


    // Opcional: Validación de consistencia
    if (Math.abs(totalNum - (precioVentaNum * cantidadNum)) > 0.01) {
      // La diferencia es mayor a 1 centavo, indica inconsistencia entre precio, cantidad y total
      console.warn(`Inconsistencia detectada: Total calculado ${precioVentaNum * cantidadNum} vs Total enviado ${totalNum}`);
      // Podrías devolver un error 400 aquí, pero por ahora solo es un warning
    }

    // Obtener producto (solo para validar stock y obtener nombre/código si el frontend no los envió)
    const productoRef = db.collection("productos").doc(productoId);
    const productoDoc = await productoRef.get();

    if (!productoDoc.exists) {
      return res.status(404).json({ error: "Producto no encontrado" });
    }

    const producto = productoDoc.data();

    // Validar stock
    if (producto.stock < cantidadNum) {
      return res.status(400).json({ error: "Stock insuficiente" });
    }

    // Descontar stock
    await productoRef.update({
      stock: producto.stock - cantidadNum
    });

    // Generar código de venta V00X
    const codigoVenta = await generarCodigoVenta();

    // Crear objeto de venta
    const ventaData = {
      codigo: codigoVenta,
      productoId,
      cantidad: cantidadNum,
      total: totalNum,
      monto: montoNum,
      cambio: cambioNum,
      nota: nota || "",
      fecha: new Date(),
      // CAMPOS AÑADIDOS PARA EL CÁLCULO FUTURO DE GANANCIA
      precioVentaUnitario: precioVentaNum,
      precioCompraUnitario: precioCompraNum
    };

    // Guardar venta
    const ventaRef = await db.collection("ventas").add(ventaData);

    res.json({
      mensaje: "Venta registrada correctamente",
      id: ventaRef.id,
      venta: ventaData
    });

  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});



// Obtener todas las ventas con datos del producto
app.get("/ventas", async (req, res) => {
  try {
    const ventasSnapshot = await db.collection("ventas").get();
    const ventas = [];

    for (const doc of ventasSnapshot.docs) {
      const venta = doc.data();
      venta.id = doc.id;

      // Obtener datos del producto
      const productoRef = db.collection("productos").doc(venta.productoId);
      const productoDoc = await productoRef.get();

      if (productoDoc.exists) {
        const producto = productoDoc.data();
        venta.productoNombre = producto.nombre;
        venta.productoCodigo = producto.codigo; // P001, P002, etc.
      } else {
        venta.productoNombre = "Producto eliminado";
        venta.productoCodigo = "-";
      }

      ventas.push(venta);
    }

    res.json(ventas);

  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});


// ----------------------
const PORT = 3000;
app.listen(PORT, () => console.log("API lista en puerto", PORT));

// Obtener una venta específica
app.get("/ventas/:id", async (req, res) => {
  try {
    const id = req.params.id;

    const ventaSnapshot = await db.collection("ventas").doc(id).get();

    if (!ventaSnapshot.exists) {
      return res.status(404).json({ error: "Venta no encontrada" });
    }

    return res.json(ventaSnapshot.data());
  } catch (error) {
    console.error("Error al obtener la venta:", error);
    return res.status(500).json({ error: "Error al obtener la venta" });
  }
});

// ------------------------------
// LOGIN
// ------------------------------

app.post('/login', async (req, res) => {
  try {
    const { usuario, password } = req.body;

    if (!usuario || !password) {
      return res.status(400).json({ error: "Faltan credenciales" });
    }

    const ref = db.collection('usuarios');
    const query = await ref.where("usuario", "==", usuario).get();

    if (query.empty) {
      return res.status(401).json({ error: "Usuario no encontrado" });
    }

    const userDoc = query.docs[0].data();

    if (userDoc.password !== password) {
      return res.status(401).json({ error: "Contraseña incorrecta" });
    }

    return res.json({ mensaje: "Inicio de sesión exitoso" });

  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
});


// Obtener total de productos, productos con bajo stock y ventas últimos 7 días
app.get("/dashboard/totales", async (req, res) => {
  try {
    // 1. Total de productos
    const productosSnapshot = await db.collection("productos").get();
    const totalProductos = productosSnapshot.size;

    // 2. Productos con stock bajo (< 10)
    const productosStockBajo = productosSnapshot.docs.filter(
      doc => doc.data().stock < 10
    ).length;

    // 3. Total de ventas últimas 7 días
    const hoy = new Date();
    const hace7dias = new Date();
    hace7dias.setDate(hoy.getDate() - 7);

    const ventasSnapshot = await db.collection("ventas").get();

    let ventasUltimos7Dias = 0;

    ventasSnapshot.forEach(doc => {
      const venta = doc.data();
      const fechaVenta = new Date(venta.fecha.toDate());

      if (fechaVenta >= hace7dias) {
        ventasUltimos7Dias += venta.total;
      }
    });

    res.json({
      totalProductos,
      productosStockBajo,
      ventasUltimos7Dias
    });

  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});
